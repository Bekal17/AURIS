import { View, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { MaterialIcons } from '@expo/vector-icons';
import ProfileScreen from '../screens/ProfileScreen';
import SettingsScreen from '../screens/SettingsScreen';

const Tab = createBottomTabNavigator();

function TabIcon({ name, focused }) {
  return (
    <View style={[styles.iconWrap, focused && styles.iconWrapActive]}>
      <MaterialIcons
        name={name}
        size={focused ? 30 : 28}
        color={focused ? '#0d1f0d' : '#ffffff'}
        style={!focused && styles.inactiveIcon}
      />
    </View>
  );
}

export default function AppNavigator({ HomeComponent, googleUser, onLogout }) {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarStyle: styles.tabBar,
        tabBarItemStyle: styles.tabItem,
      }}
    >
      <Tab.Screen
        name="Home"
        options={{
          tabBarIcon: ({ focused }) => <TabIcon name="home" focused={focused} />,
        }}
      >
        {() => <HomeComponent />}
      </Tab.Screen>
      <Tab.Screen
        name="Profil"
        options={{
          tabBarIcon: ({ focused }) => <TabIcon name="person" focused={focused} />,
        }}
      >
        {() => <ProfileScreen googleUser={googleUser} />}
      </Tab.Screen>
      <Tab.Screen
        name="Pengaturan"
        options={{
          tabBarIcon: ({ focused }) => <TabIcon name="settings" focused={focused} />,
        }}
      >
        {() => <SettingsScreen googleUser={googleUser} onLogout={onLogout} />}
      </Tab.Screen>
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    position: 'absolute',
    left: 18,
    right: 18,
    bottom: 18,
    height: 74,
    backgroundColor: '#0d1f0d',
    borderTopWidth: 0,
    borderRadius: 30,
    elevation: 12,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 18,
  },
  tabItem: {
    height: 74,
  },
  iconWrap: {
    alignItems: 'center',
    height: 58,
    justifyContent: 'center',
    width: 58,
  },
  iconWrapActive: {
    backgroundColor: '#ffffff',
    borderRadius: 32,
    height: 64,
    transform: [{ translateY: -24 }],
    width: 64,
  },
  inactiveIcon: {
    opacity: 0.5,
  },
});
