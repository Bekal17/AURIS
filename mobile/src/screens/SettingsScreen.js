import { useEffect, useState } from 'react';
import {
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const AUREL_GREEN = '#00ff88';

export default function SettingsScreen({ onLogout }) {
  const [language, setLanguage] = useState('id');

  useEffect(() => {
    AsyncStorage.getItem('aurel_language')
      .then((storedLanguage) => {
        if (storedLanguage === 'en' || storedLanguage === 'id') {
          setLanguage(storedLanguage);
        }
      })
      .catch((error) => console.warn('Failed to load language:', error));
  }, []);

  async function chooseLanguage(nextLanguage) {
    setLanguage(nextLanguage);
    await AsyncStorage.setItem('aurel_language', nextLanguage);
  }

  async function handleLogout() {
    await onLogout?.();
    Alert.alert('Logout berhasil', 'Akun Google sudah dilepas dari Aurel.');
  }

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Pengaturan</Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Bahasa</Text>
        <View style={styles.optionRow}>
          <TouchableOpacity
            style={[styles.optionButton, language === 'id' && styles.optionActive]}
            onPress={() => chooseLanguage('id')}
          >
            <Text style={[styles.optionText, language === 'id' && styles.optionTextActive]}>
              Indonesia
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.optionButton, language === 'en' && styles.optionActive]}
            onPress={() => chooseLanguage('en')}
          >
            <Text style={[styles.optionText, language === 'en' && styles.optionTextActive]}>
              English
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Akun</Text>
        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    padding: 24,
    paddingTop: 72,
  },
  header: {
    color: AUREL_GREEN,
    fontSize: 34,
    fontWeight: '800',
    marginBottom: 32,
  },
  section: {
    backgroundColor: '#101410',
    borderColor: '#1f3b25',
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: 22,
    padding: 18,
  },
  sectionTitle: {
    color: AUREL_GREEN,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 16,
  },
  optionRow: {
    flexDirection: 'row',
    gap: 12,
  },
  optionButton: {
    borderColor: '#2a4930',
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    paddingVertical: 14,
  },
  optionActive: {
    backgroundColor: AUREL_GREEN,
    borderColor: AUREL_GREEN,
  },
  optionText: {
    color: '#d7fbe1',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  optionTextActive: {
    color: '#001b08',
  },
  logoutButton: {
    alignItems: 'center',
    borderColor: '#ff5c5c',
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 14,
  },
  logoutText: {
    color: '#ff7777',
    fontSize: 16,
    fontWeight: '800',
  },
});
