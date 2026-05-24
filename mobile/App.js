import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  Animated,
  Easing,
  DeviceEventEmitter,
  Image,
  NativeModules,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { createAudioPlayer } from 'expo-audio';
import * as FileSystem from 'expo-file-system';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';

const SERVER_URL = 'https://auris-production-a715.up.railway.app';
const WS_URL = 'wss://auris-production-a715.up.railway.app/ws';
const { AurisModule, AurisPhoneModule } = NativeModules;

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

const WAKE_WORDS = ['auris', 'hei auris', 'hey auris', 'aris', 'paris'];

const STATE_CONFIG = {
  [ASSISTANT_STATE.WAKE]: {
    color: '#ffffff',
    label: "Say 'Auris' to activate",
    status: "Listening for 'Auris'...",
    pulsing: true,
  },
  [ASSISTANT_STATE.LISTENING]: {
    color: '#ff3b30',
    label: 'Listening...',
    status: 'Listening',
    pulsing: true,
  },
  [ASSISTANT_STATE.THINKING]: {
    color: '#ffd60a',
    label: 'Processing...',
    status: 'Processing',
    pulsing: false,
  },
  [ASSISTANT_STATE.SPEAKING]: {
    color: '#30d158',
    label: 'Speaking...',
    status: 'Speaking',
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
  const pendingIncomingCallRef = useRef(null);
  const startupFlowCompleteRef = useRef(false);
  const startupFlowRunningRef = useRef(false);
  const replyTimeoutRef = useRef(null);
  const speakingTimeoutRef = useRef(null);
  const floatingServiceTimeoutRef = useRef(null);
  const wsRef = useRef(null);
  const pulseScale = useRef(new Animated.Value(1)).current;
  const pulseOpacity = useRef(new Animated.Value(0.35)).current;

  const stateConfig = STATE_CONFIG[assistantState];

  useSpeechRecognitionEvent('result', handleSpeechRecognitionResult);
  useSpeechRecognitionEvent('end', handleRecognitionEnd);
  useSpeechRecognitionEvent('error', handleRecognitionError);

  useEffect(() => {
    assistantStateRef.current = assistantState;
  }, [assistantState]);

  useEffect(() => {
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
  }, [pulseOpacity, pulseScale, stateConfig.pulsing]);

  useEffect(() => {
    runStartupPermissionFlow();
    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        runStartupPermissionFlow();
      } else if (nextState === 'background') {
        startFloatingServiceWithDebug('app-background');
      }
    });

    return () => {
      appStateSubscription.remove();
      clearReplyTimeout();
      clearSpeakingTimer();
      clearFloatingServiceTimeout();
      cleanupAudioPlayback();
      closeWebSocket();
      AurisModule?.stopForegroundService?.();
      ExpoSpeechRecognitionModule.abort();
    };
  }, []);

  useEffect(() => {
    const whatsAppSubscription = DeviceEventEmitter.addListener(
      'onWhatsAppMessage',
      async (message) => {
        const rawMessage = String(message || '');
        const separatorIndex = rawMessage.indexOf(':');
        const sender =
          separatorIndex >= 0 ? rawMessage.slice(0, separatorIndex).trim() : 'Unknown';
        const text =
          separatorIndex >= 0 ? rawMessage.slice(separatorIndex + 1).trim() : rawMessage;
        const nextTranscript = `WhatsApp from ${sender}: ${text}`;

        setTranscript(nextTranscript);
        await stopVoiceListening();
        await sendTextToServer(
          `Read this WhatsApp notification aloud, then ask if I want to reply: ${nextTranscript}`,
          () => startConversationListening()
        );
      }
    );
    const incomingCallSubscription = DeviceEventEmitter.addListener(
      'onIncomingCall',
      async (caller) => {
        await handleIncomingCall(caller);
      }
    );
    const audioDeviceSubscription = DeviceEventEmitter.addListener(
      'onAudioDeviceChanged',
      async (device) => {
        await handleAudioDeviceChanged(device);
      }
    );
    const restartListeningSubscription = DeviceEventEmitter.addListener(
      'onRestartListening',
      () => {
        restartRecognition();
      }
    );

    return () => {
      whatsAppSubscription.remove();
      incomingCallSubscription.remove();
      audioDeviceSubscription.remove();
      restartListeningSubscription.remove();
    };
  }, []);

  useEffect(() => {
    initializeAudioOutputDevice();
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
      startWakeWordListening();
    }, 10000);
  }

  function closeWebSocket() {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }

  function clearFloatingServiceTimeout() {
    if (floatingServiceTimeoutRef.current) {
      clearTimeout(floatingServiceTimeoutRef.current);
      floatingServiceTimeoutRef.current = null;
    }
  }

  function startFloatingServiceWithDebug(source, delayMs = 0) {
    clearFloatingServiceTimeout();

    floatingServiceTimeoutRef.current = setTimeout(() => {
      floatingServiceTimeoutRef.current = null;
      console.log(`AURIS startFloatingService called from ${source}`);

      try {
        AurisModule?.startFloatingService?.();
      } catch (error) {
        console.warn('Failed to start AURIS floating service:', error);
      }
    }, delayMs);
  }

  function updateFloatingState(state) {
    try {
      AurisModule?.updateFloatingState?.(state);
    } catch (error) {
      console.warn('Failed to update AURIS floating state:', error);
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
        await AurisPhoneModule?.setAudioToBluetoothHeadset?.();
      } else {
        await AurisPhoneModule?.setAudioToSpeaker?.();
      }
    } catch (error) {
      console.warn('Failed to route AURIS audio:', error);
    }
  }

  async function initializeAudioOutputDevice() {
    try {
      const device = await AurisPhoneModule?.getAudioOutputDevice?.();

      if (device) {
        await routeAudioForDevice(device);
      }
    } catch (error) {
      console.warn('Failed to initialize AURIS audio output:', error);
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

      const overlayGranted = await ensureOverlayPermission();

      if (!overlayGranted) {
        return;
      }

      startFloatingServiceWithDebug('startup-after-overlay', 1000);

      const batteryOptimizationExempted = await ensureBatteryOptimizationExemption();

      if (!batteryOptimizationExempted) {
        return;
      }

      try {
        AurisModule?.startForegroundService?.();
      } catch (error) {
        console.warn('Failed to start AURIS background services:', error);
      }

      startupFlowCompleteRef.current = true;
      await startWakeWordListening();
    } finally {
      startupFlowRunningRef.current = false;
    }
  }

  async function requestStartupMicrophonePermission() {
    try {
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();

      if (!permission.granted) {
        Alert.alert(
          'Microphone Permission Required',
          'AURIS needs microphone and speech recognition access. Please enable microphone permission in Settings.'
        );
      }

      return permission.granted;
    } catch (error) {
      console.warn('Speech recognition permission request failed:', error);
      return false;
    }
  }

  async function ensureAccessibilityPermission() {
    if (!AurisModule?.isAccessibilityEnabled) {
      return true;
    }

    try {
      const enabled = await AurisModule.isAccessibilityEnabled();

      if (enabled) {
        return true;
      }

      Alert.alert(
        'Enable AURIS Accessibility',
        'Turn on AURIS in Accessibility Settings so it can detect WhatsApp messages.',
        [
          {
            text: 'Open Settings',
            onPress: () => AurisModule.openAccessibilitySettings?.(),
          },
        ],
        { cancelable: false }
      );
      return false;
    } catch (error) {
      console.warn('Failed to check AURIS accessibility status:', error);
      return false;
    }
  }

  async function ensureOverlayPermission() {
    if (!AurisModule?.isOverlayPermissionGranted) {
      return true;
    }

    try {
      const granted = await AurisModule.isOverlayPermissionGranted();

      if (granted) {
        return true;
      }

      Alert.alert(
        'Enable Overlay Permission',
        'Allow AURIS to appear over other apps so it can assist while you drive.',
        [
          { text: 'Not Now', style: 'cancel' },
          {
            text: 'Open Settings',
            onPress: () => AurisModule.requestOverlayPermission?.(),
          },
        ]
      );
      return false;
    } catch (error) {
      console.warn('Failed to check AURIS overlay permission:', error);
      return false;
    }
  }

  async function ensureBatteryOptimizationExemption() {
    if (!AurisModule?.isBatteryOptimizationExempted) {
      return true;
    }

    try {
      const exempted = await AurisModule.isBatteryOptimizationExempted();

      if (exempted) {
        return true;
      }

      Alert.alert(
        'Wajib: Izinkan AURIS Aktif Saat Layar Terkunci',
        'AURIS membutuhkan izin ini agar tetap mendengarkan saat layar terkunci. Tanpa izin ini, AURIS tidak dapat membantu saat kamu berkendara.',
        [
          {
            text: 'Izinkan Sekarang',
            onPress: () => AurisModule.requestBatteryOptimizationExemption?.(),
          },
          {
            text: 'Pelajari Lebih Lanjut',
            onPress: showBatteryOptimizationExplanation,
          },
        ]
      );
      return false;
    } catch (error) {
      console.warn('Failed to check AURIS battery optimization status:', error);
      return false;
    }
  }

  function showBatteryOptimizationExplanation() {
    Alert.alert(
      'Mengapa Izin Ini Dibutuhkan',
      'Android dapat menghentikan mikrofon, wake word, dan layanan background saat layar terkunci untuk menghemat baterai. AURIS membutuhkan pengecualian ini agar tetap siap membantu secara hands-free saat kamu berkendara.',
      [
        {
          text: 'Izinkan Sekarang',
          onPress: () => AurisModule?.requestBatteryOptimizationExemption?.(),
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
      console.warn('AURIS WebSocket error:', error);
    };
  }

  async function stopVoiceListening() {
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch (error) {
      console.warn('Speech recognition stop failed:', error);
    } finally {
      voiceActiveRef.current = false;
    }
  }

  async function startVoiceRecognition(mode) {
    try {
      await stopVoiceListening();
      const hasPermission = await ensureSpeechRecognitionPermission();

      if (!hasPermission) {
        Alert.alert(
          'Voice Recognition Required',
          'AURIS needs microphone and speech recognition access. Please enable microphone permission in Settings.'
        );
        return;
      }

      listeningModeRef.current = mode;
      voiceActiveRef.current = true;
      processingSpeechRef.current = false;
      ExpoSpeechRecognitionModule.start({
        lang: 'en-US',
        interimResults: true,
        continuous: true,
        contextualStrings: WAKE_WORDS,
        androidIntentOptions: {
          EXTRA_PARTIAL_RESULTS: true,
          EXTRA_LANGUAGE_MODEL: 'free_form',
        },
      });
    } catch (error) {
      voiceActiveRef.current = false;
      Alert.alert(
        'Voice Recognition Required',
        'AURIS needs microphone and speech recognition access. Please enable microphone permission in Settings.'
      );
      console.warn('Speech recognition failed:', error);
    }
  }

  async function ensureSpeechRecognitionPermission() {
    try {
      const existingPermission = await ExpoSpeechRecognitionModule.getPermissionsAsync();

      if (existingPermission.granted) {
        return true;
      }

      const requestedPermission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      return requestedPermission.granted;
    } catch (error) {
      console.warn('Speech recognition permission check failed:', error);
      return false;
    }
  }

  async function startWakeWordListening() {
    clearReplyTimeout();
    setAssistantState(ASSISTANT_STATE.WAKE);
    setStatusText("Listening for 'Auris'...");
    setStateLabel("Say 'Auris' to activate");
    updateFloatingState('idle');
    await startVoiceRecognition(LISTENING_MODE.WAKE);
  }

  async function startConversationListening(nextStatus = 'Listening for reply...') {
    clearReplyTimeout();
    setAssistantState(ASSISTANT_STATE.LISTENING);
    setStatusText(nextStatus);
    setStateLabel('Listening...');
    updateFloatingState('listening');
    await startVoiceRecognition(LISTENING_MODE.CONVERSATION);
    scheduleReplyTimeout();
  }

  function isInWakeMode() {
    return listeningModeRef.current === LISTENING_MODE.WAKE;
  }

  function restartRecognition() {
    if (
      processingSpeechRef.current ||
      assistantStateRef.current === ASSISTANT_STATE.SPEAKING ||
      assistantStateRef.current === ASSISTANT_STATE.THINKING
    ) {
      return;
    }

    if (listeningModeRef.current === LISTENING_MODE.CONVERSATION) {
      startVoiceRecognition(LISTENING_MODE.CONVERSATION);
    } else {
      startVoiceRecognition(LISTENING_MODE.WAKE);
    }
  }

  function handleRecognitionEnd() {
    voiceActiveRef.current = false;

    if (isInWakeMode()) {
      setTimeout(() => restartRecognition(), 500);
      return;
    }

    if (listeningModeRef.current === LISTENING_MODE.CONVERSATION) {
      setTimeout(() => restartRecognition(), 500);
    }
  }

  function handleRecognitionError() {
    voiceActiveRef.current = false;
    setTimeout(() => restartRecognition(), 1000);
  }

  function getRecognizedText(event) {
    return event?.results?.map((result) => result.transcript).join(' ') || '';
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

  async function handleIncomingCall(caller) {
    const callerName = getCallerName(caller);
    const prompt = `Ada telepon masuk dari ${callerName}, angkat?`;

    pendingIncomingCallRef.current = { callerName };
    setTranscript(`Telepon masuk dari ${callerName}`);
    setResponse(prompt);
    await stopVoiceListening();
    await sendTextToServer(`Ucapkan persis dalam Bahasa Indonesia: "${prompt}"`, () =>
      startConversationListening('Listening for call command...')
    );
  }

  async function executePhoneCommand(text) {
    const command = text.toLowerCase();

    try {
      if (command.includes('angkat') && command.includes('loudspeaker')) {
        await AurisPhoneModule?.answerCall?.();
        await AurisPhoneModule?.setSpeakerOn?.(true);
        pendingIncomingCallRef.current = null;
        setResponse('Panggilan diangkat dengan loudspeaker.');
        await startConversationListening();
        return true;
      }

      if (command.includes('angkat')) {
        await AurisPhoneModule?.answerCall?.();
        pendingIncomingCallRef.current = null;
        setResponse('Panggilan diangkat.');
        await startConversationListening();
        return true;
      }

      if (command.includes('tolak')) {
        await AurisPhoneModule?.rejectCall?.();
        pendingIncomingCallRef.current = null;
        setResponse('Panggilan ditolak.');
        await startWakeWordListening();
        return true;
      }

      if (command.includes('mute')) {
        await AurisPhoneModule?.setMute?.(true);
        setResponse('Mikrofon dimute.');
        await startConversationListening();
        return true;
      }

      if (command.includes('loudspeaker')) {
        await AurisPhoneModule?.setSpeakerOn?.(true);
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

  async function handleSpeechRecognitionResult(event) {
    const text = getRecognizedText(event);

    if (!text) {
      return;
    }

    if (listeningModeRef.current === LISTENING_MODE.WAKE && hasWakeWord(text)) {
      await activateAuris();
      return;
    }

    if (listeningModeRef.current === LISTENING_MODE.CONVERSATION) {
      scheduleReplyTimeout();

      if (!event.isFinal || processingSpeechRef.current) {
        return;
      }

      processingSpeechRef.current = true;
      clearReplyTimeout();
      await stopVoiceListening();
      setTranscript(text.trim());

      if (await executePhoneCommand(text.trim())) {
        processingSpeechRef.current = false;
        return;
      }

      await sendTextToServer(text.trim(), () => startConversationListening());
    }
  }

  async function activateAuris() {
    if (processingSpeechRef.current) {
      return;
    }

    processingSpeechRef.current = true;
    await stopVoiceListening();
    connectWebSocket();
    updateFloatingState('active');
    setTranscript("Wake word detected: Auris");
    setResponse('Yes?');
    setAssistantState(ASSISTANT_STATE.SPEAKING);
    setStatusText('Speaking...');
    setStateLabel('Speaking...');
    setTimeout(() => {
      processingSpeechRef.current = false;
      startConversationListening('AURIS Active - Speak now');
    }, 700);
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
    updateFloatingState('speaking');
    scheduleIdleState(nextResponse, afterSpeech);
  }

  async function playAudioResponse(base64Audio, afterSpeech) {
    clearSpeakingTimer();
    cleanupAudioPlayback();

    const audioFile = new FileSystem.File(
      FileSystem.Paths.cache,
      `auris-response-${Date.now()}.mp3`
    );
    audioFile.create({ overwrite: true });
    audioFile.write(base64Audio, { encoding: FileSystem.EncodingType.Base64 });
    audioFileRef.current = audioFile;

    const player = createAudioPlayer(audioFile.uri);
    audioPlayerRef.current = player;
    setAssistantState(ASSISTANT_STATE.SPEAKING);
    setStatusText('Speaking...');
    setStateLabel('Speaking...');
    updateFloatingState('speaking');

    audioSubscriptionRef.current = player.addListener('playbackStatusUpdate', (status) => {
      if (status.error) {
        console.error('AURIS audio playback error:', status.error);
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
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0a0a0a" />

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
            <Text style={styles.boxTitle}>You said</Text>
            <Text style={styles.boxText}>
              {transcript || 'Your transcript will appear here.'}
            </Text>
          </View>

          <View style={styles.responseBox}>
            <Text style={styles.boxTitle}>AURIS response</Text>
            <Text style={styles.boxText}>
              {response || 'AURIS will respond here.'}
            </Text>
          </View>

          <View style={styles.bottomStatus}>
            <View style={[styles.statusDot, { backgroundColor: stateConfig.color }]} />
            <Text style={styles.statusText}>{statusText}</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
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
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.35,
    shadowRadius: 24,
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
    backgroundColor: '#101c3a',
    borderColor: '#1e3a8a',
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
    borderColor: '#2c2c36',
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
