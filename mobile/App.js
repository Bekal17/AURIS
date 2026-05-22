import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Audio } from 'expo-av';

const SERVER_URL = 'https://auris-production-a715.up.railway.app';

const ASSISTANT_STATE = {
  IDLE: 'IDLE',
  LISTENING: 'LISTENING',
  THINKING: 'THINKING',
  SPEAKING: 'SPEAKING',
};

const STATE_CONFIG = {
  [ASSISTANT_STATE.IDLE]: {
    color: '#ffffff',
    label: 'Tap to activate',
    status: '🎤 Ready',
    pulsing: false,
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

function MicIcon({ color }) {
  return (
    <View style={styles.micIcon}>
      <View style={[styles.micHead, { borderColor: color }]} />
      <View style={[styles.micStem, { backgroundColor: color }]} />
      <View style={[styles.micBase, { backgroundColor: color }]} />
    </View>
  );
}

export default function App() {
  const [assistantState, setAssistantState] = useState(ASSISTANT_STATE.IDLE);
  const [transcript, setTranscript] = useState('');
  const [response, setResponse] = useState('');
  const recordingRef = useRef(null);
  const releaseRequestedRef = useRef(false);
  const speakingTimeoutRef = useRef(null);
  const pulseScale = useRef(new Animated.Value(1)).current;
  const pulseOpacity = useRef(new Animated.Value(0.35)).current;

  const stateConfig = STATE_CONFIG[assistantState];
  const isBusy =
    assistantState === ASSISTANT_STATE.THINKING ||
    assistantState === ASSISTANT_STATE.SPEAKING;

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

  function clearSpeakingTimer() {
    if (speakingTimeoutRef.current) {
      clearTimeout(speakingTimeoutRef.current);
      speakingTimeoutRef.current = null;
    }
  }

  async function startRecording() {
    if (recordingRef.current || isBusy) {
      return;
    }

    try {
      clearSpeakingTimer();
      releaseRequestedRef.current = false;

      const permission = await Audio.requestPermissionsAsync();

      if (!permission.granted) {
        Alert.alert('Microphone required', 'Please allow microphone access to use AURIS.');
        return;
      }

      setTranscript('');
      setResponse('');
      setAssistantState(ASSISTANT_STATE.LISTENING);

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });

      const { recording: newRecording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );

      recordingRef.current = newRecording;

      if (releaseRequestedRef.current) {
        await stopRecording(newRecording);
      }
    } catch (error) {
      console.error('Failed to start recording:', error);
      recordingRef.current = null;
      setAssistantState(ASSISTANT_STATE.IDLE);
      Alert.alert('Recording error', 'AURIS could not start listening.');
    }
  }

  async function stopRecording(activeRecording = recordingRef.current) {
    if (!activeRecording) {
      releaseRequestedRef.current = true;
      return;
    }

    try {
      releaseRequestedRef.current = false;
      setAssistantState(ASSISTANT_STATE.THINKING);
      await activeRecording.stopAndUnloadAsync();
      const uri = activeRecording.getURI();
      recordingRef.current = null;

      if (!uri) {
        throw new Error('Recording URI was not available.');
      }

      await sendAudioToServer(uri);
    } catch (error) {
      console.error('Failed to stop recording:', error);
      recordingRef.current = null;
      setAssistantState(ASSISTANT_STATE.IDLE);
      Alert.alert('Recording error', 'AURIS could not process that recording.');
    }
  }

  async function sendAudioToServer(uri) {
    const formData = new FormData();
    formData.append('audio', {
      uri,
      name: 'auris-recording.m4a',
      type: 'audio/m4a',
    });

    const result = await fetch(`${SERVER_URL}/transcribe`, {
      method: 'POST',
      body: formData,
    });

    if (!result.ok) {
      throw new Error(`Server returned ${result.status}`);
    }

    const data = await result.json();
    const nextTranscript = data.transcript || data.text || '';
    const nextResponse = data.response || data.reply || data.answer || '';

    setTranscript(nextTranscript || 'No transcript returned.');
    setResponse(nextResponse || 'No response returned.');
    setAssistantState(ASSISTANT_STATE.SPEAKING);

    const speakingDuration = Math.min(
      4500,
      Math.max(1600, (nextResponse || '').length * 45)
    );

    speakingTimeoutRef.current = setTimeout(() => {
      setAssistantState(ASSISTANT_STATE.IDLE);
      speakingTimeoutRef.current = null;
    }, speakingDuration);
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0a0a0a" />

      <View style={styles.header}>
        <Text style={styles.appName}>AURIS</Text>
        <Text style={styles.tagline}>Hands-free AI Assistant</Text>
      </View>

      <View style={styles.centerStage}>
        <View style={styles.micWrap}>
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

          <Pressable
            onPressIn={startRecording}
            onPressOut={stopRecording}
            disabled={isBusy}
            style={({ pressed }) => [
              styles.micButton,
              { borderColor: stateConfig.color },
              pressed && !isBusy ? styles.micButtonPressed : null,
            ]}
          >
            {assistantState === ASSISTANT_STATE.THINKING ? (
              <ActivityIndicator color={stateConfig.color} size="large" />
            ) : (
              <MicIcon color={stateConfig.color} />
            )}
          </Pressable>
        </View>

        <Text style={[styles.stateLabel, { color: stateConfig.color }]}>
          {stateConfig.label}
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
      </View>

      <View style={styles.bottomStatus}>
        <View style={[styles.statusDot, { backgroundColor: stateConfig.color }]} />
        <Text style={styles.statusText}>{stateConfig.status}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    paddingHorizontal: 24,
  },
  header: {
    alignItems: 'center',
    paddingTop: 34,
  },
  appName: {
    color: '#ffffff',
    fontSize: 42,
    fontWeight: '800',
    letterSpacing: 6,
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
  micWrap: {
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
  micButton: {
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
  micButtonPressed: {
    transform: [{ scale: 0.96 }],
  },
  micIcon: {
    alignItems: 'center',
    height: 62,
    justifyContent: 'flex-end',
    width: 46,
  },
  micHead: {
    borderRadius: 17,
    borderWidth: 4,
    height: 38,
    width: 26,
  },
  micStem: {
    borderRadius: 2,
    height: 16,
    marginTop: 2,
    width: 4,
  },
  micBase: {
    borderRadius: 2,
    height: 4,
    width: 28,
  },
  stateLabel: {
    fontSize: 18,
    fontWeight: '700',
    marginTop: 18,
  },
  content: {
    flex: 1,
    gap: 16,
    justifyContent: 'center',
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
    marginBottom: 24,
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
