import { useEffect, useState } from 'react';
import {
  Alert,
  Image,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const AUREL_GREEN = '#00ff88';

export default function ProfileScreen({ googleUser }) {
  const [nickname, setNickname] = useState('');
  const displayName = googleUser?.name || nickname || 'Aurel User';
  const email = googleUser?.email || 'Belum terhubung';
  const photo = googleUser?.photo || googleUser?.picture;
  const initial = displayName.trim().charAt(0).toUpperCase() || 'A';

  useEffect(() => {
    AsyncStorage.getItem('aurel_username')
      .then((storedName) => {
        if (storedName) {
          setNickname(storedName);
        } else if (googleUser?.name) {
          setNickname(googleUser.name);
        }
      })
      .catch((error) => console.warn('Failed to load nickname:', error));
  }, [googleUser?.name]);

  async function saveNickname() {
    await AsyncStorage.setItem('aurel_username', nickname.trim());
    Alert.alert('Profil disimpan', 'Nama panggilan berhasil disimpan.');
  }

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Profil</Text>

      <View style={styles.avatarWrap}>
        {photo ? (
          <Image source={{ uri: photo }} style={styles.avatarImage} />
        ) : (
          <Text style={styles.avatarInitial}>{initial}</Text>
        )}
      </View>

      <Text style={styles.label}>Nama Panggilan</Text>
      <TextInput
        value={nickname}
        onChangeText={setNickname}
        placeholder="Masukkan nama panggilan"
        placeholderTextColor="#5f7f68"
        style={styles.input}
      />

      <Text style={styles.label}>Email Google</Text>
      <View style={styles.readOnlyField}>
        <Text style={styles.readOnlyText}>{email}</Text>
      </View>

      <TouchableOpacity style={styles.button} onPress={saveNickname}>
        <Text style={styles.buttonText}>Simpan</Text>
      </TouchableOpacity>
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
  avatarWrap: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: '#102216',
    borderColor: AUREL_GREEN,
    borderRadius: 56,
    borderWidth: 2,
    height: 112,
    justifyContent: 'center',
    marginBottom: 34,
    overflow: 'hidden',
    width: 112,
  },
  avatarImage: {
    height: 112,
    width: 112,
  },
  avatarInitial: {
    color: AUREL_GREEN,
    fontSize: 44,
    fontWeight: '800',
  },
  label: {
    color: AUREL_GREEN,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 10,
  },
  input: {
    backgroundColor: '#101410',
    borderColor: '#1f3b25',
    borderRadius: 16,
    borderWidth: 1,
    color: '#ffffff',
    fontSize: 17,
    marginBottom: 24,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  readOnlyField: {
    backgroundColor: '#101410',
    borderColor: '#1f3b25',
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 32,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  readOnlyText: {
    color: '#d7fbe1',
    fontSize: 16,
  },
  button: {
    alignItems: 'center',
    backgroundColor: AUREL_GREEN,
    borderRadius: 18,
    paddingVertical: 16,
  },
  buttonText: {
    color: '#001b08',
    fontSize: 17,
    fontWeight: '800',
  },
});
