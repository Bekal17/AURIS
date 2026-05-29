import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  DeviceEventEmitter,
  Image,
  Linking,
  NativeModules,
  PermissionsAndroid,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { createAudioPlayer } from 'expo-audio';
import * as FileSystem from 'expo-file-system';
import AurelFace from './src/AurelFace';
import { useGoogleAuth, saveGoogleToken, getGoogleToken } from './src/GoogleAuth';
import {
  getUpcomingEvents,
  createEvent,
  deleteEvent,
  searchEvents,
  formatEventsForSpeech,
} from './src/GoogleCalendar';
import { getUnreadEmails, formatEmailsForSpeech } from './src/GoogleGmail';

const SERVER_URL = 'https://auris-production-a715.up.railway.app';
const WS_URL = 'wss://auris-production-a715.up.railway.app/ws';

function hasNativeMethod(moduleName, methodName) {
  const nativeModule = NativeModules[moduleName];

  if (!nativeModule) {
    console.error(`${moduleName} not found!`);
    return false;
  }

  if (typeof nativeModule[methodName] !== 'function') {
    console.error(`${moduleName}.${methodName} not found!`);
    return false;
  }

  return true;
}

function callNativeModule(moduleName, methodName, ...args) {
  console.log(`Calling ${moduleName}.${methodName}`);

  if (!hasNativeMethod(moduleName, methodName)) {
    return undefined;
  }

  return NativeModules[moduleName][methodName](...args);
}

const ASSISTANT_STATE = {
  WAKE: 'WAKE',
  LISTENING: 'LISTENING',
  THINKING: 'THINKING',
  SPEAKING: 'SPEAKING',
};

const LISTENING_MODE = {
  WAKE: 'WAKE',
  CONVERSATION: 'CONVERSATION',
};

const AUREL_GREEN = '#00FF41';
const STOP_COMMANDS = ['stop', 'berhenti', 'selesai'];
const CONVERSATION_SILENCE_TIMEOUT_MS = 10000;
const WHATSAPP_UNAVAILABLE_MESSAGE = 'WhatsApp tidak terinstall di HP ini.';

const STATE_CONFIG = {
  [ASSISTANT_STATE.WAKE]: {
    color: AUREL_GREEN,
    label: "Ucapkan 'Aurel' untuk memulai",
    status: "Mendengarkan 'Aurel'...",
    pulsing: true,
  },
  [ASSISTANT_STATE.LISTENING]: {
    color: AUREL_GREEN,
    label: 'Mendengarkan...',
    status: 'Mendengarkan balasan...',
    pulsing: true,
  },
  [ASSISTANT_STATE.THINKING]: {
    color: '#ffd60a',
    label: 'Memproses...',
    status: 'Memproses...',
    pulsing: false,
  },
  [ASSISTANT_STATE.SPEAKING]: {
    color: AUREL_GREEN,
    label: 'Aurel sedang berbicara...',
    status: 'Aurel sedang berbicara...',
    pulsing: true,
  },
};

export default function App() {
  console.log('Aurel App: component mounted');

  const { request: googleAuthRequest, response: googleAuthResponse, promptAsync } = useGoogleAuth();
  const [assistantState, setAssistantState] = useState(ASSISTANT_STATE.WAKE);
  const [statusText, setStatusText] = useState(STATE_CONFIG[ASSISTANT_STATE.WAKE].status);
  const [stateLabel, setStateLabel] = useState(STATE_CONFIG[ASSISTANT_STATE.WAKE].label);
  const [transcript, setTranscript] = useState('');
  const [response, setResponse] = useState('');
  const [audioOutputDevice, setAudioOutputDevice] = useState('unknown');
  const [isCallActive, setIsCallActive] = useState(false);
  const assistantStateRef = useRef(ASSISTANT_STATE.WAKE);
  const audioPlayerRef = useRef(null);
  const audioSubscriptionRef = useRef(null);
  const audioFileRef = useRef(null);
  const listeningModeRef = useRef(LISTENING_MODE.WAKE);
  const voiceActiveRef = useRef(false);
  const processingSpeechRef = useRef(false);
  const recordingActiveRef = useRef(false);
  const pendingIncomingCallRef = useRef(null);
  const pendingWhatsAppCallRef = useRef(null);
  const pendingWhatsAppReplyRef = useRef(null);
  const pendingAurelIntentRef = useRef(null);
  const isCallActiveRef = useRef(false);
  const startupFlowCompleteRef = useRef(false);
  const startupFlowRunningRef = useRef(false);
  const replyTimeoutRef = useRef(null);
  const speakingTimeoutRef = useRef(null);
  const conversationSilenceDeadlineRef = useRef(null);
  const wsRef = useRef(null);

  const stateConfig = STATE_CONFIG[assistantState];

  useEffect(() => {
    try {
      assistantStateRef.current = assistantState;
    } catch (e) {
      console.error('useEffect error:', e.message);
    }
  }, [assistantState]);

  useEffect(() => {
    try {
      if (googleAuthResponse?.type === 'success') {
        const { authentication } = googleAuthResponse;
        if (authentication?.accessToken) {
          saveGoogleToken(authentication.accessToken)
            .then(() => speakText('Google Calendar dan Gmail berhasil terhubung!'))
            .catch((error) => console.warn('Failed to save Google token:', error));
        }
      }
    } catch (e) {
      console.error('useEffect error:', e.message);
    }
  }, [googleAuthResponse]);

  useEffect(() => {
    try {
      runStartupPermissionFlow();
      const appStateSubscription = AppState.addEventListener('change', (nextState) => {
        if (nextState === 'active') {
          runStartupPermissionFlow();
        }
      });

      return () => {
        appStateSubscription.remove();
        clearReplyTimeout();
        clearSpeakingTimer();
        cleanupAudioPlayback();
        closeWebSocket();
        callNativeModule('AurisModule', 'stopForegroundService');
        callNativeModule('AurelWakeWordModule', 'stopWakeWordListening');
        callNativeModule('AurelSpeechModule', 'destroyRecognizer');
      };
    } catch (e) {
      console.error('useEffect error:', e.message);
      return undefined;
    }
  }, []);

  useEffect(() => {
    try {
      const whatsAppSubscription = DeviceEventEmitter.addListener(
        'onWhatsAppMessage',
        async (message) => {
          const rawMessage = String(message || '');
          const separatorIndex = rawMessage.indexOf(':');
          const sender =
            separatorIndex >= 0 ? rawMessage.slice(0, separatorIndex).trim() : 'Unknown';
          const text =
            separatorIndex >= 0 ? rawMessage.slice(separatorIndex + 1).trim() : rawMessage;
          const nextTranscript = `WhatsApp dari ${sender}: ${text}`;

          pendingWhatsAppReplyRef.current = {
            sender,
            message: text,
            awaitingReplyText: false,
          };
          setTranscript(nextTranscript);
          await stopVoiceListening();
          await sendTextToServer(
            `Ada pesan WhatsApp dari ${sender}: ${text}. Bacakan dan tanya apakah mau dibalas`,
            () => startConversationListening('Mendengarkan perintah balasan WhatsApp...')
          );
        }
      );
      const incomingCallSubscription = DeviceEventEmitter.addListener(
        'onIncomingCall',
        async (caller) => {
          await handleIncomingCall(caller);
        }
      );
      const whatsAppCallSubscription = DeviceEventEmitter.addListener(
        'onWhatsAppCall',
        async (title) => {
          await handleWhatsAppCall(title);
        }
      );
      const audioDeviceSubscription = DeviceEventEmitter.addListener(
        'onAudioDeviceChanged',
        async (device) => {
          await handleAudioDeviceChanged(device);
        }
      );
      const phoneStateSubscription = DeviceEventEmitter.addListener(
        'onPhoneStateChanged',
        async (phoneState) => {
          await handlePhoneStateChanged(phoneState);
        }
      );
      const recordingCompleteSubscription = DeviceEventEmitter.addListener(
        'onRecordingComplete',
        handleRecordingComplete
      );
      const wakeWordSubscription = DeviceEventEmitter.addListener(
        'onWakeWordDetected',
        handleWakeWordDetected
      );

      return () => {
        whatsAppSubscription.remove();
        incomingCallSubscription.remove();
        whatsAppCallSubscription.remove();
        audioDeviceSubscription.remove();
        phoneStateSubscription.remove();
        recordingCompleteSubscription.remove();
        wakeWordSubscription.remove();
      };
    } catch (e) {
      console.error('useEffect error:', e.message);
      return undefined;
    }
  }, []);

  useEffect(() => {
    try {
      initializeAudioOutputDevice();
    } catch (e) {
      console.error('useEffect error:', e.message);
    }
  }, []);

  function clearSpeakingTimer() {
    if (speakingTimeoutRef.current) {
      clearTimeout(speakingTimeoutRef.current);
      speakingTimeoutRef.current = null;
    }
  }

  function cleanupAudioPlayback() {
    audioSubscriptionRef.current?.remove();
    audioSubscriptionRef.current = null;

    if (audioPlayerRef.current) {
      audioPlayerRef.current.remove();
      audioPlayerRef.current = null;
    }

    if (audioFileRef.current?.exists) {
      audioFileRef.current.delete();
      audioFileRef.current = null;
    }
  }

  function clearReplyTimeout() {
    if (replyTimeoutRef.current) {
      clearTimeout(replyTimeoutRef.current);
      replyTimeoutRef.current = null;
    }
  }

  function resetConversationSilenceWindow() {
    conversationSilenceDeadlineRef.current = Date.now() + CONVERSATION_SILENCE_TIMEOUT_MS;
  }

  function hasConversationTimedOut() {
    return Boolean(
      conversationSilenceDeadlineRef.current &&
        Date.now() >= conversationSilenceDeadlineRef.current
    );
  }

  function scheduleReplyTimeout() {
    clearReplyTimeout();

    if (isCallActiveRef.current) {
      replyTimeoutRef.current = setTimeout(() => {
        startConversationListening("Telepon aktif - ucapkan 'Aurel' untuk perintah", false);
      }, CONVERSATION_SILENCE_TIMEOUT_MS);
      return;
    }

    const remainingMs = conversationSilenceDeadlineRef.current
      ? Math.max(0, conversationSilenceDeadlineRef.current - Date.now())
      : CONVERSATION_SILENCE_TIMEOUT_MS;

    replyTimeoutRef.current = setTimeout(() => {
      playSleepSoundAndStartWakeMode();
    }, remainingMs);
  }

  function closeWebSocket() {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }

  function updateNotificationState(state) {
    try {
      callNativeModule('AurisModule', 'updateNotificationState', state);
    } catch (error) {
      console.warn('Failed to update Aurel notification state:', error);
    }
  }

  function normalizeAudioDevice(device) {
    if (typeof device === 'string') {
      return device.toLowerCase();
    }

    return (
      device?.device ||
      device?.type ||
      device?.name ||
      'unknown'
    ).toLowerCase();
  }

  async function routeAudioForDevice(device) {
    const nextDevice = normalizeAudioDevice(device);
    setAudioOutputDevice(nextDevice);

    try {
      if (nextDevice.includes('bluetooth')) {
        await callNativeModule('AurisPhoneModule', 'setAudioToBluetoothHeadset');
      } else {
        await callNativeModule('AurisPhoneModule', 'setAudioToSpeaker');
      }
    } catch (error) {
      console.warn('Failed to route Aurel audio:', error);
    }
  }

  async function initializeAudioOutputDevice() {
    try {
      const device = await callNativeModule('AurisPhoneModule', 'getAudioOutputDevice');

      if (device) {
        await routeAudioForDevice(device);
      }
    } catch (error) {
      console.warn('Failed to initialize Aurel audio output:', error);
    }
  }

  async function handleAudioDeviceChanged(device) {
    await routeAudioForDevice(device);
  }

  async function handlePhoneStateChanged(phoneState) {
    const nextPhoneState = String(phoneState || '').toUpperCase();
    console.log(`Phone state changed: ${nextPhoneState}`);

    if (nextPhoneState === 'RINGING') {
      return;
    }

    if (nextPhoneState === 'OFFHOOK') {
      isCallActiveRef.current = true;
      setIsCallActive(true);
      await stopWakeWordListening();
      setStatusText("Telepon aktif - ucapkan 'Aurel' untuk perintah");
      setStateLabel('Telepon aktif');
      updateNotificationState('listening');
      await startConversationListening("Telepon aktif - ucapkan 'Aurel' untuk perintah", false);
      return;
    }

    if (nextPhoneState === 'IDLE') {
      const wasCallActive = isCallActiveRef.current;
      isCallActiveRef.current = false;
      setIsCallActive(false);

      if (wasCallActive) {
        setStatusText('Telepon selesai');
        setStateLabel("Ucapkan 'Aurel' untuk memulai");
        await speakText('Telepon selesai', () => startWakeWordListening());
      } else if (startupFlowCompleteRef.current) {
        await startWakeWordListening();
      }
    }
  }

  async function promptGoogleConnectionIfNeeded() {
    try {
      const googleToken = await getGoogleToken();
      if (googleToken) {
        return;
      }

      Alert.alert(
        'Hubungkan Google',
        'Hubungkan Google Calendar dan Gmail agar Aurel bisa membaca jadwal dan email kamu.',
        [
          {
            text: 'Hubungkan',
            onPress: () => {
              if (!googleAuthRequest) {
                Alert.alert('Google belum siap', 'Coba buka lagi beberapa detik lagi.');
                return;
              }
              promptAsync();
            },
          },
          { text: 'Nanti', style: 'cancel' },
        ]
      );
    } catch (error) {
      console.warn('Failed to check Google token:', error);
    }
  }

  async function runStartupPermissionFlow() {
    if (startupFlowCompleteRef.current || startupFlowRunningRef.current) {
      return;
    }

    startupFlowRunningRef.current = true;

    try {
      const micGranted = await requestStartupMicrophonePermission();

      if (!micGranted) {
        return;
      }

      const accessibilityGranted = await ensureAccessibilityPermission();

      if (!accessibilityGranted) {
        return;
      }

      const batteryOptimizationExempted = await ensureBatteryOptimizationExemption();

      if (!batteryOptimizationExempted) {
        return;
      }

      await requestContactsPermission();
      await promptGoogleConnectionIfNeeded();

      try {
        callNativeModule('AurisModule', 'startForegroundService');
        callNativeModule('AurisPhoneModule', 'registerCallStateListener');
      } catch (error) {
        console.warn('Failed to start Aurel background services:', error);
      }

      startupFlowCompleteRef.current = true;
      await startWakeWordListening();
    } finally {
      startupFlowRunningRef.current = false;
    }
  }

  async function requestStartupMicrophonePermission() {
    try {
      const permission = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO
      );
      const granted = permission === PermissionsAndroid.RESULTS.GRANTED;

      if (!granted) {
        Alert.alert(
          'Microphone Permission Required',
          'Aurel needs microphone and speech recognition access. Please enable microphone permission in Settings.'
        );
      }

      return granted;
    } catch (error) {
      console.warn('Audio recording permission request failed:', error);
      return false;
    }
  }

  async function requestContactsPermission() {
    try {
      const existingPermission = await PermissionsAndroid.check(
        PermissionsAndroid.PERMISSIONS.READ_CONTACTS
      );

      if (existingPermission) {
        return true;
      }

      const permission = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.READ_CONTACTS
      );
      const granted = permission === PermissionsAndroid.RESULTS.GRANTED;

      if (!granted) {
        Alert.alert(
          'Izin Kontak Diperlukan',
          'Fitur kirim & telepon WhatsApp via nama tidak tersedia. Izin kontak ditolak.'
        );
      }

      return granted;
    } catch (error) {
      console.warn('Contacts permission request failed:', error);
      return false;
    }
  }

  async function ensureAccessibilityPermission() {
    if (!hasNativeMethod('AurisModule', 'isAccessibilityEnabled')) {
      return true;
    }

    try {
      const enabled = await callNativeModule('AurisModule', 'isAccessibilityEnabled');

      if (enabled) {
        return true;
      }

      Alert.alert(
        'Enable Aurel Accessibility',
        'Turn on Aurel in Accessibility Settings so it can detect WhatsApp messages.',
        [
          {
            text: 'Open Settings',
            onPress: () => callNativeModule('AurisModule', 'openAccessibilitySettings'),
          },
        ],
        { cancelable: false }
      );
      return false;
    } catch (error) {
      console.warn('Failed to check Aurel accessibility status:', error);
      return false;
    }
  }

  async function ensureBatteryOptimizationExemption() {
    if (!hasNativeMethod('AurisModule', 'isBatteryOptimizationExempted')) {
      return true;
    }

    try {
      const exempted = await callNativeModule('AurisModule', 'isBatteryOptimizationExempted');

      if (exempted) {
        return true;
      }

      Alert.alert(
        'Wajib: Izinkan Aurel Aktif Saat Layar Terkunci',
        'Aurel membutuhkan izin ini agar tetap mendengarkan saat layar terkunci. Tanpa izin ini, Aurel tidak dapat membantu saat kamu berkendara.',
        [
          {
            text: 'Izinkan Sekarang',
            onPress: () => callNativeModule('AurisModule', 'requestBatteryOptimizationExemption'),
          },
          {
            text: 'Pelajari Lebih Lanjut',
            onPress: showBatteryOptimizationExplanation,
          },
        ]
      );
      return false;
    } catch (error) {
      console.warn('Failed to check Aurel battery optimization status:', error);
      return false;
    }
  }

  function showBatteryOptimizationExplanation() {
    Alert.alert(
      'Mengapa Izin Ini Dibutuhkan',
      'Android dapat menghentikan mikrofon, wake word, dan layanan background saat layar terkunci untuk menghemat baterai. Aurel membutuhkan pengecualian ini agar tetap siap membantu secara hands-free saat kamu berkendara.',
      [
        {
          text: 'Izinkan Sekarang',
          onPress: () => callNativeModule('AurisModule', 'requestBatteryOptimizationExemption'),
        },
        {
          text: 'Kembali',
          onPress: () => {
            setTimeout(() => {
              ensureBatteryOptimizationExemption();
            }, 300);
          },
        },
      ]
    );
  }

  function connectWebSocket() {
    if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) {
      return;
    }

    wsRef.current = new WebSocket(WS_URL);
    wsRef.current.onmessage = (event) => {
      if (typeof event.data !== 'string') {
        return;
      }

      try {
        const payload = JSON.parse(event.data);

        if (payload.type === 'transcript' && payload.transcript) {
          setTranscript(payload.transcript);
        }

        if (payload.type === 'response' && payload.response) {
          setResponse(payload.response);
        }
      } catch {
        // Binary audio chunks are handled by native playback in future iterations.
      }
    };
    wsRef.current.onerror = (error) => {
      console.warn('Aurel WebSocket error:', error);
    };
  }

  async function stopVoiceListening() {
    try {
      recordingActiveRef.current = false;
      await callNativeModule('AurelSpeechModule', 'stopRecordingChunk');
    } catch (error) {
      console.warn('Audio recording stop failed:', error);
    } finally {
      voiceActiveRef.current = false;
    }
  }

  async function stopWakeWordListening() {
    try {
      await callNativeModule('AurelWakeWordModule', 'stopWakeWordListening');
    } catch (error) {
      console.warn('Wake word listening stop failed:', error);
    }
  }

  async function stopAllListeningAndSetIdle() {
    clearReplyTimeout();
    clearSpeakingTimer();
    conversationSilenceDeadlineRef.current = null;
    processingSpeechRef.current = false;
    await stopVoiceListening();
    await stopWakeWordListening();
    listeningModeRef.current = LISTENING_MODE.WAKE;
    setAssistantState(ASSISTANT_STATE.WAKE);
    setStatusText('Idle');
    setStateLabel('Aurel berhenti');
    setResponse('Aurel berhenti.');
    updateNotificationState('idle');
  }

  async function startAudioRecording(mode) {
    try {
      if (isCallActiveRef.current) {
        const audioMode = await (
          NativeModules.AurisPhoneModule?.getAudioMode?.() ?? Promise.resolve('unknown')
        );

        if (audioMode === 'in_call') {
          console.log('Call active - limited listening mode');
        }
      }

      await stopVoiceListening();
      if (mode === LISTENING_MODE.CONVERSATION) {
        await stopWakeWordListening();
      }
      const hasPermission = await ensureSpeechRecognitionPermission();

      if (!hasPermission) {
        Alert.alert(
          'Audio Recording Required',
          'Aurel needs microphone and speech recognition access. Please enable microphone permission in Settings.'
        );
        return;
      }

      if (!hasNativeMethod('AurelSpeechModule', 'startRecordingChunk')) {
        Alert.alert(
          'Audio Recording Required',
          'Aurel native audio recording is not available in this build.'
        );
        return;
      }

      listeningModeRef.current = mode;
      voiceActiveRef.current = true;
      recordingActiveRef.current = true;
      processingSpeechRef.current = false;
      const durationMs = mode === LISTENING_MODE.CONVERSATION ? 5000 : 3000;

      if (hasNativeMethod('AurelSpeechModule', 'startRecordingChunkWithDuration')) {
        await callNativeModule('AurelSpeechModule', 'startRecordingChunkWithDuration', durationMs);
      } else {
        await callNativeModule('AurelSpeechModule', 'startRecordingChunk');
      }
    } catch (error) {
      voiceActiveRef.current = false;
      recordingActiveRef.current = false;
      Alert.alert(
        'Audio Recording Required',
        'Aurel needs microphone and speech recognition access. Please enable microphone permission in Settings.'
      );
      console.warn('Audio recording failed:', error);
    }
  }

  async function ensureSpeechRecognitionPermission() {
    try {
      const existingPermission = await PermissionsAndroid.check(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO
      );

      if (existingPermission) {
        return true;
      }

      const requestedPermission = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO
      );
      return requestedPermission === PermissionsAndroid.RESULTS.GRANTED;
    } catch (error) {
      console.warn('Audio recording permission check failed:', error);
      return false;
    }
  }

  async function startWakeWordListening() {
    if (isCallActiveRef.current) {
      await stopVoiceListening();
      setStatusText("Telepon aktif - ucapkan 'Aurel' untuk perintah");
      setStateLabel('Telepon aktif');
      updateNotificationState('listening');
      return;
    }

    clearReplyTimeout();
    conversationSilenceDeadlineRef.current = null;
    pendingAurelIntentRef.current = null;
    await stopVoiceListening();
    setAssistantState(ASSISTANT_STATE.WAKE);
    setStatusText("Mendengarkan 'Aurel'...");
    setStateLabel("Ucapkan 'Aurel' untuk memulai");
    updateNotificationState('idle');
    listeningModeRef.current = LISTENING_MODE.WAKE;
    voiceActiveRef.current = true;
    processingSpeechRef.current = false;

    try {
      if (!hasNativeMethod('AurelWakeWordModule', 'startWakeWordListening')) {
        Alert.alert(
          'Wake Word Required',
          'Aurel native wake word detection is not available in this build.'
        );
        return;
      }

      await callNativeModule('AurelWakeWordModule', 'startWakeWordListening');
    } catch (error) {
      voiceActiveRef.current = false;
      console.warn('Wake word listening failed:', error);
      Alert.alert(
        'Wake Word Required',
        'Aurel wake word model is not available. Make sure soundclassifier_with_metadata.tflite is included in Android assets.'
      );
    }
  }

  async function startConversationListening(
    nextStatus = 'Mendengarkan perintah...',
    resetSilenceWindow = true
  ) {
    clearReplyTimeout();
    if (resetSilenceWindow) {
      resetConversationSilenceWindow();
    }
    setAssistantState(ASSISTANT_STATE.LISTENING);
    setStatusText(nextStatus);
    setStateLabel('Mendengarkan...');
    updateNotificationState('listening');
    await startAudioRecording(LISTENING_MODE.CONVERSATION);
    scheduleReplyTimeout();
  }

  function isStopCommand(text) {
    const normalizedText = String(text || '')
      .toLowerCase()
      .replace(/[^a-z\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return STOP_COMMANDS.some((command) => {
      return new RegExp(`(^|\\s)${command}(\\s|$)`).test(normalizedText);
    });
  }

  function getCallerName(caller) {
    if (typeof caller === 'string') {
      return caller || 'Tidak dikenal';
    }

    return caller?.name || caller?.number || caller?.caller || 'Tidak dikenal';
  }

  function getWhatsAppCallerName(title) {
    const rawTitle = String(title || '').trim();
    const callerName = rawTitle
      .replace(/panggilan masuk/gi, '')
      .replace(/incoming video call/gi, '')
      .replace(/incoming call/gi, '')
      .replace(/[:\-–—]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return callerName || rawTitle || 'Tidak dikenal';
  }

  async function handleIncomingCall(caller) {
    const callerName = getCallerName(caller);
    const prompt = `Ada telepon masuk dari ${callerName}, angkat?`;

    pendingIncomingCallRef.current = { callerName };
    setTranscript(`Telepon masuk dari ${callerName}`);
    setResponse(prompt);
    await stopVoiceListening();
    await sendTextToServer(`Ucapkan persis dalam Bahasa Indonesia: "${prompt}"`, () =>
      startConversationListening('Mendengarkan perintah telepon...')
    );
  }

  async function handleWhatsAppCall(title) {
    const callerName = getWhatsAppCallerName(title);
    const prompt = `Ada panggilan WhatsApp dari ${callerName}. Angkat, angkat loudspeaker, atau tolak?`;

    pendingWhatsAppCallRef.current = { callerName };
    setTranscript(`Panggilan WhatsApp dari ${callerName}`);
    setResponse(prompt);
    await stopVoiceListening();
    await speakText(prompt, () =>
      startConversationListening('Mendengarkan perintah panggilan WhatsApp...')
    );
  }

  function getWhatsAppReplyText(commandText) {
    return commandText.replace(/^.*?\bbalas\b/i, '').trim();
  }

  async function executeWhatsAppCommand(text) {
    const pendingWhatsApp = pendingWhatsAppReplyRef.current;

    if (!pendingWhatsApp) {
      return false;
    }

    const command = text.toLowerCase();

    if (command.includes('abaikan') || command.includes('skip')) {
      pendingWhatsAppReplyRef.current = null;
      setResponse('Pesan WhatsApp diabaikan.');
      await startWakeWordListening();
      return true;
    }

    if (pendingWhatsApp.awaitingReplyText) {
      await sendWhatsAppReply(text.trim());
      return true;
    }

    if (command.includes('balas')) {
      const replyText = getWhatsAppReplyText(text);

      if (!replyText) {
        pendingWhatsAppReplyRef.current = {
          ...pendingWhatsApp,
          awaitingReplyText: true,
        };
        setResponse('Mau balas apa?');
        await startConversationListening('Mendengarkan teks balasan WhatsApp...');
        return true;
      }

      await sendWhatsAppReply(replyText);
      return true;
    }

    return false;
  }

  async function sendWhatsAppReply(replyText) {
    try {
      await callNativeModule('AurisModule', 'replyToWhatsApp', replyText);
      pendingWhatsAppReplyRef.current = null;
      setTranscript(`Balas WhatsApp: ${replyText}`);
      setResponse('Pesan WhatsApp dikirim.');
      await startWakeWordListening();
    } catch (error) {
      setResponse(`Gagal mengirim balasan WhatsApp: ${error.message}`);
      await startConversationListening('Mendengarkan perintah balasan WhatsApp...');
    }
  }

  async function executeWhatsAppCallCommand(text) {
    if (!pendingWhatsAppCallRef.current) {
      return false;
    }

    const command = text.toLowerCase();

    try {
      if (command.includes('abaikan')) {
        pendingWhatsAppCallRef.current = null;
        setResponse('Panggilan WhatsApp diabaikan.');
        await startWakeWordListening();
        return true;
      }

      if (command.includes('tolak') || command.includes('jangan') || command.includes('reject')) {
        await callNativeModule('AurisPhoneModule', 'rejectWhatsAppCall');
        pendingWhatsAppCallRef.current = null;
        setResponse('Panggilan WhatsApp ditolak.');
        await startWakeWordListening();
        return true;
      }

      if (
        command.includes('angkat loudspeaker') ||
        (command.includes('angkat') && command.includes('speaker')) ||
        command.includes('speaker')
      ) {
        await callNativeModule('AurisPhoneModule', 'answerWhatsAppCall');
        await callNativeModule('AurisPhoneModule', 'setSpeakerOn', true);
        pendingWhatsAppCallRef.current = null;
        setResponse('Panggilan WhatsApp diangkat dengan loudspeaker.');
        await startConversationListening();
        return true;
      }

      if (command.includes('angkat')) {
        await callNativeModule('AurisPhoneModule', 'answerWhatsAppCall');
        pendingWhatsAppCallRef.current = null;
        setResponse('Panggilan WhatsApp diangkat.');
        await startConversationListening();
        return true;
      }
    } catch (error) {
      console.error('WhatsApp call command failed:', error);
      setResponse(`Gagal menjalankan perintah panggilan WhatsApp: ${error.message}`);
      await startConversationListening('Mendengarkan perintah panggilan WhatsApp...');
      return true;
    }

    return false;
  }

  async function executeVolumeCommand(text) {
    const command = text.toLowerCase();
    let direction = null;

    if (command.includes('volume maksimal')) {
      direction = 'max';
    } else if (command.includes('volume minimal')) {
      direction = 'min';
    } else if (command.includes('kecilkan volume') || command.includes('volume kecil')) {
      direction = 'down';
    } else if (
      command.includes('besarkan volume') ||
      command.includes('volume besar') ||
      command.includes('keraskan')
    ) {
      direction = 'up';
    }

    if (!direction) {
      return false;
    }

    try {
      await callNativeModule('AurisPhoneModule', 'setVolume', direction);
      setResponse('Volume disesuaikan.');
      await startConversationListening();
    } catch (error) {
      setResponse(`Gagal mengatur volume: ${error.message}`);
      await startConversationListening();
    }

    return true;
  }

  async function executePhoneCommand(text) {
    const command = text.toLowerCase();

    try {
      if (command.includes('angkat') && command.includes('loudspeaker')) {
        await callNativeModule('AurisPhoneModule', 'answerCall');
        await callNativeModule('AurisPhoneModule', 'setSpeakerOn', true);
        pendingIncomingCallRef.current = null;
        setResponse('Panggilan diangkat dengan loudspeaker.');
        await startConversationListening();
        return true;
      }

      if (command.includes('angkat')) {
        await callNativeModule('AurisPhoneModule', 'answerCall');
        pendingIncomingCallRef.current = null;
        setResponse('Panggilan diangkat.');
        await startConversationListening();
        return true;
      }

      if (command.includes('tolak')) {
        await callNativeModule('AurisPhoneModule', 'rejectCall');
        pendingIncomingCallRef.current = null;
        setResponse('Panggilan ditolak.');
        await startWakeWordListening();
        return true;
      }

      if (command.includes('unmute') || command.includes('aktifkan mic')) {
        await callNativeModule('AurisPhoneModule', 'setMute', false);
        setResponse('Mikrofon diaktifkan.');
        await startConversationListening();
        return true;
      }

      if (command.includes('mute') || command.includes('bisukan')) {
        await callNativeModule('AurisPhoneModule', 'setMute', true);
        setResponse('Mikrofon dimute.');
        await startConversationListening();
        return true;
      }

      if (command.includes('loudspeaker')) {
        await callNativeModule('AurisPhoneModule', 'setSpeakerOn', true);
        setResponse('Loudspeaker dinyalakan.');
        await startConversationListening();
        return true;
      }
    } catch (error) {
      console.error('Phone command failed:', error);
      setResponse(`Gagal menjalankan perintah telepon: ${error.message}`);
      await startConversationListening();
      return true;
    }

    return false;
  }

  async function handleRecordingComplete(base64Audio) {
    recordingActiveRef.current = false;

    if (!base64Audio || processingSpeechRef.current) {
      return;
    }

    if (listeningModeRef.current !== LISTENING_MODE.CONVERSATION) {
      return;
    }

    await handleConversationRecordingComplete(base64Audio);
  }

  async function handleWakeWordDetected(payload) {
    const eventText = String(payload || '');
    const [type, confidence] = eventText.split(':');

    console.log(`Wake word event: ${type} ${confidence || ''}`);

    if (type === 'STOP') {
      await stopAllListeningAndSetIdle();
      return;
    }

    if (
      type === 'AUREL' &&
      listeningModeRef.current === LISTENING_MODE.WAKE &&
      !processingSpeechRef.current
    ) {
      await activateAurel();
    }
  }

  async function handleConversationRecordingComplete(base64Audio) {
    processingSpeechRef.current = true;
    clearReplyTimeout();

    try {
      const data = await transcribeConversationAudio(base64Audio);
      const commandText = String(data.transcript || '').trim();

      if (!commandText) {
        processingSpeechRef.current = false;
        if (hasConversationTimedOut()) {
          await playSleepSoundAndStartWakeMode();
        } else {
          await startConversationListening('Mendengarkan perintah...', false);
        }
        return;
      }

      setTranscript(commandText);

      if (isCallActiveRef.current) {
        const normalizedCommand = commandText.toLowerCase();

        if (normalizedCommand.includes('aurel')) {
          const phoneCommand = normalizedCommand.replace(/\baurel\b/g, '').trim();
          const handled = await executePhoneCommand(phoneCommand || normalizedCommand);

          if (handled) {
            return;
          }
        }

        processingSpeechRef.current = false;
        await startConversationListening("Telepon aktif - ucapkan 'Aurel' untuk perintah", false);
        return;
      }

      if (isStopCommand(commandText)) {
        setResponse('Aurel berhenti.');
        pendingAurelIntentRef.current = null;
        processingSpeechRef.current = false;
        await startWakeWordListening();
        return;
      }

      if (pendingAurelIntentRef.current) {
        await handlePendingAurelIntent(commandText);
        return;
      }

      await handleClaudeIntentData(commandText, data, () => startConversationListening());
    } catch (error) {
      console.error('Failed to process recorded command:', error);
      setResponse(`Server error: ${error.message}`);
      processingSpeechRef.current = false;
      await startWakeWordListening();
    }
  }

  async function transcribeConversationAudio(audio) {
    const result = await fetch(`${SERVER_URL}/transcribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ audio }),
    });
    const data = await result.json();

    if (!result.ok) {
      throw new Error(data.error || data.response || `Server returned ${result.status}`);
    }

    return data;
  }

  async function handleClaudeResponse(transcript, afterIntent) {
    const result = await fetch(`${SERVER_URL}/transcribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: transcript }),
    });
    const data = await result.json();

    if (!result.ok) {
      throw new Error(data.error || data.response || `Server returned ${result.status}`);
    }

    return handleClaudeIntentData(transcript, data, afterIntent);
  }

  async function handleClaudeIntentData(transcriptText, data, afterIntent) {
    let intent;

    try {
      intent = JSON.parse(data.response);
    } catch {
      intent = { action: 'speak', speak: data.speak || data.response };
    }

    const speak = intent.speak || data.speak || data.response || 'Baik.';
    setTranscript(transcriptText);
    setResponse(speak);

    const runAction = async () => {
      const shouldContinue = await executeClaudeIntent(intent);
      if (shouldContinue && afterIntent) {
        afterIntent();
      }
    };

    if (data.audio) {
      await playResponseAudioOrSchedule(data.audio, speak, runAction);
      return;
    }

    await speakText(speak, runAction);
  }

  async function executeClaudeIntent(intent) {
    switch (intent.action) {
      case 'send_wa':
        if (!intent.message) {
          startFollowUpRecording('send_wa_message', intent.contact);
          return false;
        }
        return sendWhatsAppByContact(intent.contact, intent.message);
      case 'call_wa':
        await callWhatsAppContact(intent.contact, intent.option);
        return true;
      case 'reply_wa':
        if (hasNativeMethod('AurisModule', 'replyToWhatsApp')) {
          await callNativeModule('AurisModule', 'replyToWhatsApp', intent.message || '');
        }
        return true;
      case 'answer_call':
        if (hasNativeMethod('AurisPhoneModule', 'answerWhatsAppCall')) {
          await callNativeModule('AurisPhoneModule', 'answerWhatsAppCall');
          if (intent.option === 'loudspeaker') {
            setTimeout(() => {
              callNativeModule('AurisPhoneModule', 'setSpeakerOn', true);
            }, 2000);
          }
        }
        return true;
      case 'reject_call':
        if (hasNativeMethod('AurisPhoneModule', 'rejectWhatsAppCall')) {
          await callNativeModule('AurisPhoneModule', 'rejectWhatsAppCall');
        }
        return true;
      case 'volume':
        if (hasNativeMethod('AurisPhoneModule', 'setVolume')) {
          await callNativeModule('AurisPhoneModule', 'setVolume', intent.direction);
        }
        return true;
      case 'mute':
        if (hasNativeMethod('AurisPhoneModule', 'setMute')) {
          await callNativeModule('AurisPhoneModule', 'setMute', Boolean(intent.enabled));
        }
        return true;
      case 'calendar_today': {
        const token = await getGoogleToken();
        if (!token) {
          await speakText('Silakan hubungkan Google Calendar terlebih dahulu.');
          return true;
        }
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const events = await getUpcomingEvents(token, 10);
        const todayEvents = events.filter((event) => {
          const start = new Date(event.start?.dateTime || event.start?.date);
          return start >= today && start < tomorrow;
        });
        const speech = todayEvents.length === 0
          ? 'Tidak ada jadwal hari ini.'
          : `Hari ini ada ${todayEvents.length} jadwal: ${formatEventsForSpeech(todayEvents)}`;
        await speakText(speech);
        return true;
      }
      case 'calendar_tomorrow': {
        const token = await getGoogleToken();
        if (!token) {
          await speakText('Silakan hubungkan Google Calendar terlebih dahulu.');
          return true;
        }
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);
        const dayAfter = new Date(tomorrow);
        dayAfter.setDate(dayAfter.getDate() + 1);
        const events = await getUpcomingEvents(token, 10);
        const tomorrowEvents = events.filter((event) => {
          const start = new Date(event.start?.dateTime || event.start?.date);
          return start >= tomorrow && start < dayAfter;
        });
        const speech = tomorrowEvents.length === 0
          ? 'Tidak ada jadwal besok.'
          : `Besok ada ${tomorrowEvents.length} jadwal: ${formatEventsForSpeech(tomorrowEvents)}`;
        await speakText(speech);
        return true;
      }
      case 'calendar_add': {
        const token = await getGoogleToken();
        if (!token) {
          await speakText('Silakan hubungkan Google Calendar terlebih dahulu.');
          return true;
        }
        const event = {
          summary: intent.title,
          start: { dateTime: intent.datetime, timeZone: 'Asia/Jakarta' },
          end: {
            dateTime: new Date(new Date(intent.datetime).getTime() + 3600000).toISOString(),
            timeZone: 'Asia/Jakarta',
          },
        };
        await createEvent(token, event);
        await speakText(`Jadwal ${intent.title} berhasil ditambahkan.`);
        return true;
      }
      case 'calendar_delete': {
        const token = await getGoogleToken();
        if (!token) {
          await speakText('Silakan hubungkan Google Calendar terlebih dahulu.');
          return true;
        }
        const events = await searchEvents(token, intent.query);
        if (events.length === 0) {
          await speakText(`Jadwal ${intent.query} tidak ditemukan.`);
        } else {
          await deleteEvent(token, events[0].id);
          await speakText(`Jadwal ${events[0].summary} berhasil dihapus.`);
        }
        return true;
      }
      case 'gmail_read': {
        const token = await getGoogleToken();
        if (!token) {
          await speakText('Silakan hubungkan Gmail terlebih dahulu.');
          return true;
        }
        const emails = await getUnreadEmails(token, 3);
        const speech = formatEmailsForSpeech(emails);
        await speakText(speech);
        return true;
      }
      case 'speak':
      default:
        return true;
    }
  }

  function startFollowUpRecording(type, contact) {
    pendingAurelIntentRef.current = { type, contact };
    startConversationListening('Mendengarkan isi pesan WhatsApp...', false);
  }

  async function handlePendingAurelIntent(commandText) {
    const pendingIntent = pendingAurelIntentRef.current;
    pendingAurelIntentRef.current = null;

    if (pendingIntent?.type === 'send_wa_message') {
      await sendWhatsAppByContact(pendingIntent.contact, commandText);
      return;
    }

    if (pendingIntent?.type === 'confirm_send_wa') {
      if (isConfirmSendCommand(commandText)) {
        if (!(await ensureWhatsAppAvailable())) {
          return;
        }

        await Linking.openURL(
          `whatsapp://send?phone=${pendingIntent.phone}&text=${encodeURIComponent(pendingIntent.message)}`
        );
        setResponse(`Oke, membuka WhatsApp untuk kirim pesan ke ${pendingIntent.contact}`);
        processingSpeechRef.current = false;
        await startConversationListening();
        return;
      }

      if (isCancelSendCommand(commandText)) {
        setResponse('Dibatalkan');
        processingSpeechRef.current = false;
        await speakText('Dibatalkan', () => startWakeWordListening());
        return;
      }

      pendingAurelIntentRef.current = pendingIntent;
      await speakText('Konfirmasi belum jelas. Bilang ya untuk kirim atau batal untuk membatalkan.', () =>
        startConversationListening('Mendengarkan konfirmasi WhatsApp...', false)
      );
      return;
    }

    processingSpeechRef.current = false;
    await startConversationListening();
  }

  async function findFirstContact(contactName) {
    if (!contactName || !hasNativeMethod('AurelContactsModule', 'findContact')) {
      return null;
    }

    const contacts = await callNativeModule('AurelContactsModule', 'findContact', contactName);
    return contacts?.length > 0 ? contacts[0] : null;
  }

  function cleanPhoneNumber(phone) {
    return String(phone || '').replace(/[^0-9+]/g, '');
  }

  function isConfirmSendCommand(text) {
    const command = String(text || '').toLowerCase();
    return command.includes('ya') || command.includes('oke') || command.includes('kirim');
  }

  function isCancelSendCommand(text) {
    const command = String(text || '').toLowerCase();
    return command.includes('batal') || command.includes('tidak') || command.includes('cancel');
  }

  async function ensureWhatsAppAvailable() {
    const canOpen = await Linking.canOpenURL('whatsapp://send?phone=1');

    if (!canOpen) {
      setResponse(WHATSAPP_UNAVAILABLE_MESSAGE);
      await speakText(WHATSAPP_UNAVAILABLE_MESSAGE);
      return false;
    }

    return true;
  }

  async function sendWhatsAppByContact(contactName, message) {
    const contact = await findFirstContact(contactName);
    if (!contact) {
      setResponse(`Kontak ${contactName} tidak ditemukan.`);
      return true;
    }

    if (!(await ensureWhatsAppAvailable())) {
      return true;
    }

    const cleanPhone = cleanPhoneNumber(contact.phone);
    const confirmationPrompt = `Mau kirim '${message}' ke ${contact.name}? Bilang ya atau batal.`;
    pendingAurelIntentRef.current = {
      type: 'confirm_send_wa',
      contact: contact.name || contactName,
      phone: cleanPhone,
      message,
    };
    setResponse(confirmationPrompt);
    await speakText(confirmationPrompt, () =>
      startConversationListening('Mendengarkan konfirmasi WhatsApp...', false)
    );
    return false;
  }

  async function callWhatsAppContact(contactName, option) {
    const contact = await findFirstContact(contactName);
    if (!contact) {
      setResponse(`Kontak ${contactName} tidak ditemukan.`);
      return;
    }

    if (!(await ensureWhatsAppAvailable())) {
      return;
    }

    const cleanPhone = cleanPhoneNumber(contact.phone);
    await Linking.openURL(`whatsapp://call?phone=${cleanPhone}`);

    if (option === 'loudspeaker') {
      setTimeout(() => {
        callNativeModule('AurisPhoneModule', 'setSpeakerOn', true);
      }, 3000);
    }
  }

  async function activateAurel() {
    if (processingSpeechRef.current) {
      return;
    }

    processingSpeechRef.current = true;
    await stopVoiceListening();
    await stopWakeWordListening();
    connectWebSocket();
    updateNotificationState('active');
    setTranscript("Wake word detected: Aurel");
    setResponse('Yes bos');
    setAssistantState(ASSISTANT_STATE.SPEAKING);
    setStatusText('Mendengarkan perintah...');
    setStateLabel('Aurel Aktif - Silakan bicara');
    await speakText('Yes bos', () => {
      processingSpeechRef.current = false;
      startConversationListening('Mendengarkan perintah...');
    });
  }

  async function sendTextToServer(text, afterSpeech) {
    try {
      clearSpeakingTimer();
      setResponse('');
      setAssistantState(ASSISTANT_STATE.THINKING);
      await handleClaudeResponse(text, afterSpeech);
    } catch (error) {
      console.error('Failed to process WhatsApp message:', error);
      setResponse(`Server error: ${error.message}`);
      processingSpeechRef.current = false;
      await startWakeWordListening();
    }
  }

  async function getSpeakAudio(text) {
    const result = await fetch(`${SERVER_URL}/speak`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    });
    const rawResponse = await result.text();
    let data = {};

    try {
      data = rawResponse ? JSON.parse(rawResponse) : {};
    } catch {
      data = {};
    }

    if (!result.ok) {
      throw new Error(data.error || `Server returned ${result.status}`);
    }

    return data.audio;
  }

  async function speakText(text, afterSpeech) {
    try {
      const audio = await getSpeakAudio(text);

      if (audio) {
        await playAudioResponse(audio, afterSpeech);
        return;
      }
    } catch (error) {
      console.warn('Failed to play Aurel speech cue:', error);
    }

    if (afterSpeech) {
      afterSpeech();
    }
  }

  async function playSleepSoundAndStartWakeMode() {
    clearReplyTimeout();
    processingSpeechRef.current = true;
    conversationSilenceDeadlineRef.current = null;
    await stopVoiceListening();
    setStatusText("Mendengarkan 'Aurel'...");
    setStateLabel("Ucapkan 'Aurel' untuk memulai");
    updateNotificationState('idle');
    await speakText('Tidur', () => startWakeWordListening());
  }

  async function playResponseAudioOrSchedule(audio, nextResponse, afterSpeech) {
    if (audio) {
      try {
        await playAudioResponse(audio, afterSpeech);
        return;
      } catch (error) {
        console.error('Failed to play response audio:', error);
      }
    }

    setAssistantState(ASSISTANT_STATE.SPEAKING);
    updateNotificationState('speaking');
    scheduleIdleState(nextResponse, afterSpeech);
  }

  async function playAudioResponse(base64Audio, afterSpeech) {
    clearSpeakingTimer();
    cleanupAudioPlayback();

    const audioFile = new FileSystem.File(
      FileSystem.Paths.cache,
      `aurel-response-${Date.now()}.mp3`
    );
    audioFile.create({ overwrite: true });
    audioFile.write(base64Audio, { encoding: FileSystem.EncodingType.Base64 });
    audioFileRef.current = audioFile;

    const player = createAudioPlayer(audioFile.uri);
    audioPlayerRef.current = player;
    setAssistantState(ASSISTANT_STATE.SPEAKING);
    setStatusText('Aurel sedang berbicara...');
    setStateLabel('Aurel sedang berbicara...');
    updateNotificationState('speaking');

    audioSubscriptionRef.current = player.addListener('playbackStatusUpdate', (status) => {
      if (status.error) {
        console.error('Aurel audio playback error:', status.error);
        cleanupAudioPlayback();
        processingSpeechRef.current = false;
        if (afterSpeech) {
          afterSpeech();
        } else {
          startWakeWordListening();
        }
        return;
      }

      if (status.didJustFinish) {
        cleanupAudioPlayback();
        processingSpeechRef.current = false;
        if (afterSpeech) {
          afterSpeech();
        } else {
          startWakeWordListening();
        }
      }
    });

    player.play();
  }

  function scheduleIdleState(nextResponse, afterSpeech) {
    clearSpeakingTimer();
    const speakingDuration = Math.min(
      4500,
      Math.max(1600, (nextResponse || '').length * 45)
    );

    speakingTimeoutRef.current = setTimeout(() => {
      processingSpeechRef.current = false;
      speakingTimeoutRef.current = null;
      if (afterSpeech) {
        afterSpeech();
      } else {
        startWakeWordListening();
      }
    }, speakingDuration);
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={AUREL_GREEN} />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Image source={require('./assets/logo.png')} style={styles.logo} />
        </View>

        <View style={styles.centerStage}>
          <AurelFace state={assistantState} />
          <Text style={[styles.stateLabel, { color: stateConfig.color }]}>
            {stateLabel}
          </Text>
        </View>

        <View style={styles.content}>
          <View style={styles.transcriptBox}>
            <Text style={styles.boxTitle}>KAMU BILANG</Text>
            <Text style={styles.boxText}>
              {transcript || 'Transkripsi akan muncul di sini.'}
            </Text>
          </View>

          <View style={styles.responseBox}>
            <Text style={styles.boxTitle}>AUREL</Text>
            <Text style={styles.boxText}>
              {response || 'Aurel akan merespons di sini.'}
            </Text>
          </View>

          <View style={styles.bottomStatus}>
            <View style={[styles.statusDot, { backgroundColor: stateConfig.color }]} />
            <Text style={styles.statusText}>
              {isCallActive ? `${statusText} · Mode telepon` : statusText}
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'flex-end',
    position: 'absolute',
    right: 16,
    top: 40,
    zIndex: 10,
  },
  logo: {
    height: 36,
    width: 36,
  },
  centerStage: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 96,
  },
  stateLabel: {
    fontSize: 18,
    fontWeight: '700',
    marginTop: 18,
  },
  content: {
    gap: 16,
    marginTop: 44,
  },
  transcriptBox: {
    backgroundColor: '#24242a',
    borderColor: '#33333d',
    borderRadius: 20,
    borderWidth: 1,
    minHeight: 112,
    padding: 18,
  },
  responseBox: {
    backgroundColor: '#0f1f14',
    borderColor: AUREL_GREEN,
    borderRadius: 20,
    borderWidth: 1,
    minHeight: 132,
    padding: 18,
  },
  boxTitle: {
    color: '#d1d5db',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  boxText: {
    color: '#f3f4f6',
    fontSize: 16,
    lineHeight: 23,
  },
  bottomStatus: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: '#15151c',
    borderColor: AUREL_GREEN,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    marginBottom: 40,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  statusDot: {
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  statusText: {
    color: '#f3f4f6',
    fontSize: 15,
    fontWeight: '700',
  },
});
