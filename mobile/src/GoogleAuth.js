import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import AsyncStorage from '@react-native-async-storage/async-storage';

WebBrowser.maybeCompleteAuthSession();

const GOOGLE_CLIENT_ID = '533114252060-ltfgjjs6h8o20pocmfbrf4rglrrqbk4u.apps.googleusercontent.com';
const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
];

export function useGoogleAuth() {
  const [request, response, promptAsync] = Google.useAuthRequest({
    androidClientId: GOOGLE_CLIENT_ID,
    scopes: SCOPES,
  });

  return { request, response, promptAsync };
}

export async function saveGoogleToken(token) {
  await AsyncStorage.setItem('google_access_token', token);
  const expiry = Date.now() + 3600 * 1000;
  await AsyncStorage.setItem('google_token_expiry', expiry.toString());
}

export async function getGoogleToken() {
  const token = await AsyncStorage.getItem('google_access_token');
  const expiry = await AsyncStorage.getItem('google_token_expiry');
  if (!token || !expiry) return null;
  if (Date.now() > parseInt(expiry, 10)) return null;
  return token;
}

export async function clearGoogleToken() {
  await AsyncStorage.removeItem('google_access_token');
  await AsyncStorage.removeItem('google_token_expiry');
}
