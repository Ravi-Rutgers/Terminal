import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Animated,
  Dimensions,
  SafeAreaView,
} from 'react-native';
import { Slot, usePathname, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { getItem } from '../../utils/storage';
import { useStore } from '../../store';

const ACCENT_KEY = 'hussle_accent_color';
const DRAWER_WIDTH = 260;
const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface MenuItem {
  route: string;
  title: string;
  icon: string;
  section?: string;
}

const MENU_ITEMS: MenuItem[] = [
  { route: '/(tabs)/terminal', title: 'Terminal', icon: 'terminal', section: 'Hoofd' },
  { route: '/(tabs)/agents', title: 'Agents', icon: 'people', section: 'Hoofd' },
  { route: '/(tabs)/github', title: 'GitHub', icon: 'logo-github', section: 'Hoofd' },
  { route: '/(tabs)/changes', title: 'Changes', icon: 'git-compare-outline', section: 'Hoofd' },
  { route: '/(tabs)/editor', title: 'Editor', icon: 'code-slash', section: 'Hoofd' },
  { route: '/(tabs)/logs', title: 'Logs', icon: 'document-text', section: 'Monitor' },
  { route: '/(tabs)/usage', title: 'Usage', icon: 'stats-chart', section: 'Monitor' },
  { route: '/(tabs)/costs', title: 'Kosten', icon: 'wallet', section: 'Monitor' },
  { route: '/(tabs)/settings', title: 'Instellingen', icon: 'settings-sharp', section: 'Overig' },
];

export default function DrawerLayout() {
  const { accentColor, setAccentColor } = useStore();
  const router = useRouter();
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const slideAnim = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const overlayAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    getItem(ACCENT_KEY).then((stored) => {
      if (stored) setAccentColor(stored);
    });
  }, []);

  const toggleDrawer = () => {
    if (drawerOpen) closeDrawer();
    else openDrawer();
  };

  const openDrawer = () => {
    setDrawerOpen(true);
    Animated.parallel([
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 65,
        friction: 11,
      }),
      Animated.timing(overlayAnim, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const closeDrawer = () => {
    Animated.parallel([
      Animated.spring(slideAnim, {
        toValue: -DRAWER_WIDTH,
        useNativeDriver: true,
        tension: 65,
        friction: 11,
      }),
      Animated.timing(overlayAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => setDrawerOpen(false));
  };

  const navigateTo = (route: string) => {
    router.push(route as any);
    closeDrawer();
  };

  // Determine active route from pathname
  const activeTab = pathname.split('/').pop() || 'terminal';

  let lastSection = '';

  return (
    <View style={styles.container}>
      {/* Header */}
      <SafeAreaView style={styles.headerSafe}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={toggleDrawer}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="menu" size={24} color="#e0e0e0" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>
            {MENU_ITEMS.find(m => m.route.endsWith(activeTab))?.title || 'Hussle'}
          </Text>
          <View style={{ width: 24 }} />
        </View>
      </SafeAreaView>

      {/* Content */}
      <View style={styles.content}>
        <Slot />
      </View>

      {/* Overlay — tap to close */}
      {drawerOpen && (
        <TouchableWithoutFeedback onPress={closeDrawer}>
          <Animated.View
            style={[
              styles.overlay,
              { opacity: overlayAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 0.5] }) },
            ]}
          />
        </TouchableWithoutFeedback>
      )}

      {/* Drawer */}
      <Animated.View
        style={[
          styles.drawer,
          { transform: [{ translateX: slideAnim }] },
        ]}
      >
        <SafeAreaView style={styles.drawerSafe}>
          {/* Drawer header */}
          <View style={styles.drawerHeader}>
            <View style={[styles.logoCircle, { backgroundColor: accentColor }]}>
              <Ionicons name="terminal" size={20} color="#0a0a0a" />
            </View>
            <Text style={styles.drawerTitle}>Hussle</Text>
          </View>

          {/* Menu items */}
          {MENU_ITEMS.map((item) => {
            const tabName = item.route.split('/').pop() || '';
            const isActive = activeTab === tabName;
            const showSection = item.section && item.section !== lastSection;
            if (item.section) lastSection = item.section;

            return (
              <View key={item.route}>
                {showSection && (
                  <Text style={styles.sectionLabel}>{item.section}</Text>
                )}
                <TouchableOpacity
                  style={[styles.menuItem, isActive && { backgroundColor: accentColor + '18' }]}
                  onPress={() => navigateTo(item.route)}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={item.icon as any}
                    size={20}
                    color={isActive ? accentColor : '#888'}
                  />
                  <Text style={[styles.menuText, isActive && { color: accentColor, fontWeight: '700' }]}>
                    {item.title}
                  </Text>
                  {isActive && <View style={[styles.activeDot, { backgroundColor: accentColor }]} />}
                </TouchableOpacity>
              </View>
            );
          })}
        </SafeAreaView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  headerSafe: {
    backgroundColor: '#0a0a0a',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  headerTitle: {
    color: '#e0e0e0',
    fontSize: 17,
    fontWeight: '700',
  },
  content: {
    flex: 1,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000',
    zIndex: 10,
  },
  drawer: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    width: DRAWER_WIDTH,
    backgroundColor: '#0a0a0a',
    borderRightWidth: 1,
    borderRightColor: '#1a1a1a',
    zIndex: 20,
    elevation: 20,
    shadowColor: '#000',
    shadowOffset: { width: 4, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
  },
  drawerSafe: {
    flex: 1,
  },
  drawerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
    marginBottom: 8,
  },
  logoCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  drawerTitle: {
    color: '#e0e0e0',
    fontSize: 17,
    fontWeight: '800',
    marginLeft: 12,
  },
  sectionLabel: {
    color: '#555',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 6,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
    marginHorizontal: 8,
    borderRadius: 10,
  },
  menuText: {
    color: '#ccc',
    fontSize: 15,
    marginLeft: 14,
    flex: 1,
  },
  activeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
});
