import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  Animated,
  Easing,
  DeviceEventEmitter,
  Image,
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
const WAKE_WORDS = ['aurel', 'hei aurel', 'hey aurel', 'orel', 'el'];

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

function Waveform({ color }) {
  return (
    <View style={styles.waveform}>
      <View style={[styles.waveDot, styles.waveDotSmall, { backgroundColor: color }]} />
      <View style={[styles.waveDot, styles.waveDotMedium, { backgroundColor: color }]} />
      <View style={[styles.waveDot, styles.waveDotLarge, { backgroundColor: color }]} />
      <View style={[styles.waveDot, styles.waveDotMedium, { backgroundColor: color }]} />
      <View style={[styles.waveDot, styles.waveDotSmall, { backgroundColor: color }]} />
    </View>
  );
}

export default function App() {
  console.log('Aurel App: component mounted');

  const [assistantState, setAssistantState] = useState(ASSISTANT_STATE.WAKE);
  const [statusText, setStatusText] = useState(STATE_CONFIG[ASSISTANT_STATE.WAKE].status);
  const [stateLabel, setStateLabel] = useState(STATE_CONFIG[ASSISTANT_STATE.WAKE].label);
  const [transcript, setTranscript] = useState('');
  const [response, setResponse] = useState('');
  const [audioOutputDevice, setAudioOutputDevice] = useState('unknown');
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
  const startupFlowCompleteRef = useRef(false);
  const startupFlowRunningRef = useRef(false);
  const replyTimeoutRef = useRef(null);
  const speakingTimeoutRef = useRef(null);
  const wsRef = useRef(null);
  const pulseScale = useRef(new Animated.Value(1)).current;
  const pulseOpacity = useRef(new Animated.Value(0.35)).current;

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
      if (!stateConfig.pulsing) {
        pulseScale.setValue(1);
        pulseOpacity.setValue(0.35);
        return undefined;
      }

      const animation = Animated.loop(
        Animated.parallel([
          Animated.sequence([
            Animated.timing(pulseScale, {
              toValue: 1.28,
              duration: 850,
              easing: Easing.out(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(pulseScale, {
              toValue: 1,
              duration: 850,
              easing: Easing.in(Easing.ease),
              useNativeDriver: true,
            }),
          ]),
          Animated.sequence([
            Animated.timing(pulseOpacity, {
              toValue: 0.08,
              duration: 850,
              useNativeDriver: true,
            }),
            Animated.timing(pulseOpacity, {
              toValue: 0.35,
              duration: 850,
              useNativeDriver: true,
            }),
          ]),
        ])
      );

      animation.start();

      return () => animation.stop();
    } catch (e) {
      console.error('useEffect error:', e.message);
      return undefined;
    }
  }, [pulseOpacity, pulseScale, stateConfig.pulsing]);

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
      const recordingCompleteSubscription = DeviceEventEmitter.addListener(
        'onRecordingComplete',
        handleRecordingComplete
      );

      return () => {
        whatsAppSubscription.remove();
        incomingCallSubscription.remove();
        whatsAppCallSubscription.remove();
        audioDeviceSubscription.remove();
        recordingCompleteSubscription.remove();
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

  function scheduleReplyTimeout() {
    clearReplyTimeout();
    replyTimeoutRef.current = setTimeout(() => {
      playSleepSoundAndStartWakeMode();
    }, 10000);
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

      try {
        callNativeModule('AurisModule', 'startForegroundService');
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

  async function startAudioRecording(mode) {
    try {
      await stopVoiceListening();
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
    clearReplyTimeout();
    setAssistantState(ASSISTANT_STATE.WAKE);
    setStatusText("Mendengarkan 'Aurel'...");
    setStateLabel("Ucapkan 'Aurel' untuk memulai");
    updateNotificationState('idle');
    await startAudioRecording(LISTENING_MODE.WAKE);
  }

  async function startConversationListening(nextStatus = 'Mendengarkan balasan...') {
    clearReplyTimeout();
    setAssistantState(ASSISTANT_STATE.LISTENING);
    setStatusText(nextStatus);
    setStateLabel('Mendengarkan...');
    updateNotificationState('listening');
    await startAudioRecording(LISTENING_MODE.CONVERSATION);
    scheduleReplyTimeout();
  }

  function hasWakeWord(text) {
    const normalizedText = text
      .toLowerCase()
      .replace(/[^a-z\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return WAKE_WORDS.some((wakeWord) => {
      const normalizedWakeWord = wakeWord.replace(/\s+/g, '\\s+');
      return new RegExp(`(^|\\s)${normalizedWakeWord}(\\s|$)`).test(normalizedText);
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
      if (listeningModeRef.current === LISTENING_MODE.WAKE && !processingSpeechRef.current) {
        await startWakeWordListening();
      }
      return;
    }

    if (listeningModeRef.current === LISTENING_MODE.WAKE) {
      await handleWakeRecordingComplete(base64Audio);
      return;
    }

    await handleConversationRecordingComplete(base64Audio);
  }

  async function handleWakeRecordingComplete(base64Audio) {
    try {
      const transcript = await transcribeWakeAudio(base64Audio);

      if (transcript) {
        setTranscript(transcript);
      }

      if (hasWakeWord(transcript)) {
        await activateAurel();
        return;
      }
    } catch (error) {
      console.warn('Wake transcription failed:', error);
    }

    await startWakeWordListening();
  }

  async function handleConversationRecordingComplete(base64Audio) {
    processingSpeechRef.current = true;
    clearReplyTimeout();

    try {
      const data = await transcribeConversationAudio(base64Audio);
      const commandText = String(data.transcript || '').trim();

      if (!commandText) {
        processingSpeechRef.current = false;
        await startConversationListening();
        return;
      }

      setTranscript(commandText);

      if (await executeVolumeCommand(commandText)) {
        processingSpeechRef.current = false;
        return;
      }

      if (await executeWhatsAppCallCommand(commandText)) {
        processingSpeechRef.current = false;
        return;
      }

      if (await executeWhatsAppCommand(commandText)) {
        processingSpeechRef.current = false;
        return;
      }

      if (await executePhoneCommand(commandText)) {
        processingSpeechRef.current = false;
        return;
      }

      const nextResponse = data.response || data.reply || data.answer || 'Tidak ada respons.';
      setResponse(nextResponse);
      await playResponseAudioOrSchedule(data.audio, nextResponse, () => startConversationListening());
    } catch (error) {
      console.error('Failed to process recorded command:', error);
      setResponse(`Server error: ${error.message}`);
      processingSpeechRef.current = false;
      await startWakeWordListening();
    }
  }

  async function transcribeWakeAudio(audio) {
    const result = await fetch(`${SERVER_URL}/transcribe-wake`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ audio, type: 'wake' }),
    });
    const data = await result.json();

    if (!result.ok) {
      throw new Error(data.error || `Server returned ${result.status}`);
    }

    return String(data.transcript || '').trim();
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

  async function activateAurel() {
    if (processingSpeechRef.current) {
      return;
    }

    processingSpeechRef.current = true;
    await stopVoiceListening();
    connectWebSocket();
    updateNotificationState('active');
    setTranscript("Wake word detected: Aurel");
    setResponse('Ya?');
    setAssistantState(ASSISTANT_STATE.SPEAKING);
    setStatusText('Aurel Aktif - Silakan bicara');
    setStateLabel('Aurel Aktif - Silakan bicara');
    await speakText('Ya?', () => {
      processingSpeechRef.current = false;
      startConversationListening('Aurel Aktif - Silakan bicara');
    });
  }

  async function sendTextToServer(text, afterSpeech) {
    try {
      clearSpeakingTimer();
      setResponse('');
      setAssistantState(ASSISTANT_STATE.THINKING);

      const result = await fetch(`${SERVER_URL}/transcribe`, {
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
        data = { response: rawResponse };
      }

      if (!result.ok) {
        throw new Error(data.error || data.response || `Server returned ${result.status}`);
      }

      const nextResponse =
        data.response || data.reply || data.answer || rawResponse || 'No response returned.';

      setResponse(nextResponse);
      await playResponseAudioOrSchedule(data.audio, nextResponse, afterSpeech);
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
          <Text style={styles.tagline}>Hands-free AI Assistant</Text>
        </View>

        <View style={styles.centerStage}>
          <View style={styles.waveWrap}>
            {stateConfig.pulsing ? (
              <Animated.View
                style={[
                  styles.pulseCircle,
                  {
                    backgroundColor: stateConfig.color,
                    opacity: pulseOpacity,
                    transform: [{ scale: pulseScale }],
                  },
                ]}
              />
            ) : null}

            <View style={[styles.waveCard, { borderColor: stateConfig.color }]}>
              <Waveform color={stateConfig.color} />
            </View>
          </View>

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
            <Text style={styles.statusText}>{statusText}</Text>
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
    paddingTop: 34,
  },
  logo: {
    height: 80,
    width: 80,
  },
  tagline: {
    color: '#9ca3af',
    fontSize: 16,
    marginTop: 8,
  },
  centerStage: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 70,
  },
  waveWrap: {
    alignItems: 'center',
    height: 148,
    justifyContent: 'center',
    width: 148,
  },
  pulseCircle: {
    borderRadius: 74,
    height: 148,
    position: 'absolute',
    width: 148,
  },
  waveCard: {
    alignItems: 'center',
    backgroundColor: '#111118',
    borderRadius: 60,
    borderWidth: 3,
    height: 120,
    justifyContent: 'center',
    shadowColor: AUREL_GREEN,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.45,
    shadowRadius: 28,
    width: 120,
  },
  waveform: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7,
    height: 72,
    justifyContent: 'center',
    width: 82,
  },
  waveDot: {
    borderRadius: 999,
    opacity: 0.9,
    width: 8,
  },
  waveDotSmall: {
    height: 26,
  },
  waveDotMedium: {
    height: 44,
  },
  waveDotLarge: {
    height: 64,
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
