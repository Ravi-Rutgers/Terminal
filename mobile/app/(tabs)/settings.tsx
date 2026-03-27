import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  PanResponder,
  Alert,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { getItem, setItem, deleteItem } from '../../utils/storage';
import { showAlert } from '../../utils/alert';
import { Ionicons } from '@expo/vector-icons';
import { useStore } from '../../store';
import { useAuth } from '../../hooks/useAuth';
import { useApi } from '../../hooks/useApi';
import { router } from 'expo-router';
import { colors, spacing, radius, fontSize as fs } from '../../constants/theme';

const ACCENT_KEY = 'hussle_accent_color';
const FONT_SIZE_KEY = 'hussle_terminal_font_size';
const GITHUB_TOKEN_KEY = 'hussle_github_token';

const THEME_COLORS = [
  { color: '#4ade80', label: 'Groen' },
  { color: '#60a5fa', label: 'Blauw' },
  { color: '#c084fc', label: 'Paars' },
  { color: '#f472b6', label: 'Roze' },
  { color: '#facc15', label: 'Geel' },
  { color: '#fb923c', label: 'Oranje' },
  { color: '#f87171', label: 'Rood' },
  { color: '#2dd4bf', label: 'Teal' },
  { color: '#e0e0e0', label: 'Wit' },
];

const FONT_SIZES = [
  { size: 10, label: 'XS' },
  { size: 12, label: 'S' },
  { size: 14, label: 'M' },
  { size: 16, label: 'L' },
  { size: 18, label: 'XL' },
];

// --- Color conversion helpers ---

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, Math.round(l * 100)];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));

// --- Slider component ---

function ColorSlider({
  value,
  onValueChange,
  onSlideStart,
  onSlideEnd,
  gradientColors,
  label,
  displayValue,
}: {
  value: number;
  onValueChange: (v: number) => void;
  onSlideStart: () => void;
  onSlideEnd: () => void;
  gradientColors: string[];
  label: string;
  displayValue: string;
}) {
  const trackRef = useRef<View>(null);
  const callbackRef = useRef(onValueChange);
  callbackRef.current = onValueChange;

  const startRef = useRef(onSlideStart);
  startRef.current = onSlideStart;
  const endRef = useRef(onSlideEnd);
  endRef.current = onSlideEnd;

  const getRatio = (pageX: number) => {
    return new Promise<number>((resolve) => {
      trackRef.current?.measureInWindow((x, _y, width) => {
        if (width > 0) {
          resolve(clamp((pageX - x) / width, 0, 1));
        }
      });
    });
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: async (evt) => {
          startRef.current();
          const ratio = await getRatio(evt.nativeEvent.pageX);
          callbackRef.current(ratio);
        },
        onPanResponderMove: async (evt) => {
          const ratio = await getRatio(evt.nativeEvent.pageX);
          callbackRef.current(ratio);
        },
        onPanResponderRelease: () => {
          endRef.current();
        },
        onPanResponderTerminate: () => {
          endRef.current();
        },
      }),
    []
  );

  return (
    <View style={sliderStyles.wrapper}>
      <View style={sliderStyles.labelRow}>
        <Text style={sliderStyles.label}>{label}</Text>
        <Text style={sliderStyles.value}>{displayValue}</Text>
      </View>
      <View
        ref={trackRef}
        style={sliderStyles.track}
        {...panResponder.panHandlers}
      >
        <View style={sliderStyles.gradientRow} pointerEvents="none">
          {gradientColors.map((color, i) => (
            <View
              key={i}
              style={[sliderStyles.gradientSegment, { backgroundColor: color }]}
            />
          ))}
        </View>
        <View
          pointerEvents="none"
          style={[
            sliderStyles.thumb,
            { left: `${clamp(value, 0, 1) * 100}%` },
          ]}
        />
      </View>
    </View>
  );
}

const sliderStyles = StyleSheet.create({
  wrapper: { marginBottom: spacing.lg },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  label: { color: colors.textMuted, fontSize: fs.caption },
  value: { color: colors.textDim, fontSize: fs.caption, fontFamily: 'monospace' },
  track: {
    height: 36,
    borderRadius: 18,
    position: 'relative',
    justifyContent: 'center',
  },
  gradientRow: {
    flexDirection: 'row',
    height: 36,
    borderRadius: 18,
    overflow: 'hidden',
  },
  gradientSegment: {
    flex: 1,
  },
  thumb: {
    position: 'absolute',
    top: 2,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#fff',
    marginLeft: -16,
    borderWidth: 3,
    borderColor: colors.bg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 3,
    elevation: 5,
  },
});

// --- Section Header ---

function SectionHeader({ icon, title, color: iconColor }: { icon: string; title: string; color?: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Ionicons name={icon as any} size={16} color={iconColor || colors.textMuted} />
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  );
}

// --- Main screen ---

export default function SettingsScreen() {
  const { accentColor, setAccentColor, serverUrl, sessions, githubToken, setGithubToken, terminalFontSize, setTerminalFontSize, setSessions, setActiveSessionId, setShowSplash } = useStore();
  const { logout } = useAuth();
  const { apiFetch } = useApi();

  // Color picker state
  const [pickerOpen, setPickerOpen] = useState(false);
  const [hue, setHue] = useState(0);
  const [sat, setSat] = useState(80);
  const [lit, setLit] = useState(60);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const slidingRef = useRef(false);

  // Server status
  const [serverOnline, setServerOnline] = useState<boolean | null>(null);
  const [serverUptime, setServerUptime] = useState<string | null>(null);

  // GitHub
  const [ghUsername, setGhUsername] = useState<string | null>(null);
  const [ghTokenInput, setGhTokenInput] = useState('');
  const [ghLoading, setGhLoading] = useState(false);
  const [showGhInput, setShowGhInput] = useState(false);

  // Load stored settings
  useEffect(() => {
    getItem(ACCENT_KEY).then((stored) => {
      if (stored) setAccentColor(stored);
    });
    getItem(FONT_SIZE_KEY).then((stored) => {
      if (stored) setTerminalFontSize(parseInt(stored, 10));
    });
  }, []);

  // Check server status
  useEffect(() => {
    const checkServer = async () => {
      try {
        const data = await apiFetch('/api/system');
        setServerOnline(true);
        if (data?.uptime) {
          const hours = Math.floor(data.uptime / 3600);
          const mins = Math.floor((data.uptime % 3600) / 60);
          setServerUptime(`${hours}u ${mins}m`);
        }
      } catch {
        setServerOnline(false);
        setServerUptime(null);
      }
    };
    checkServer();
    const interval = setInterval(checkServer, 30000);
    return () => clearInterval(interval);
  }, [apiFetch]);

  // Fetch GitHub username
  useEffect(() => {
    if (!githubToken) {
      setGhUsername(null);
      return;
    }
    fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${githubToken}`, Accept: 'application/vnd.github+json' },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setGhUsername(data?.login || null))
      .catch(() => setGhUsername(null));
  }, [githubToken]);

  // Sync HSL sliders when accent color changes externally
  useEffect(() => {
    if (slidingRef.current) return;
    const [h, s, l] = hexToHsl(accentColor);
    setHue(h);
    setSat(s);
    setLit(l);
  }, [accentColor]);

  const pickColor = async (color: string) => {
    setAccentColor(color);
    await setItem(ACCENT_KEY, color);
  };

  const onSlideStart = () => {
    slidingRef.current = true;
    setScrollEnabled(false);
  };

  const onSlideEnd = () => {
    slidingRef.current = false;
    setScrollEnabled(true);
  };

  const hueRef = useRef(hue);
  hueRef.current = hue;
  const satRef = useRef(sat);
  satRef.current = sat;
  const litRef = useRef(lit);
  litRef.current = lit;

  const onHueChange = (ratio: number) => {
    const h = Math.round(ratio * 360);
    setHue(h);
    pickColor(hslToHex(h, satRef.current, litRef.current));
  };

  const onSatChange = (ratio: number) => {
    const s = Math.round(ratio * 100);
    setSat(s);
    pickColor(hslToHex(hueRef.current, s, litRef.current));
  };

  const onLitChange = (ratio: number) => {
    const l = Math.round(ratio * 100);
    setLit(l);
    pickColor(hslToHex(hueRef.current, satRef.current, l));
  };

  const hueStops = Array.from({ length: 13 }, (_, i) =>
    hslToHex((i / 12) * 360, sat, lit)
  );
  const satStops = [hslToHex(hue, 0, lit), hslToHex(hue, 50, lit), hslToHex(hue, 100, lit)];
  const litStops = [hslToHex(hue, sat, 0), hslToHex(hue, sat, 25), hslToHex(hue, sat, 50), hslToHex(hue, sat, 75), hslToHex(hue, sat, 100)];

  // Terminal font size
  const selectFontSize = async (size: number) => {
    setTerminalFontSize(size);
    await setItem(FONT_SIZE_KEY, String(size));
  };

  // GitHub token save
  const saveGhToken = async () => {
    const trimmed = ghTokenInput.trim();
    if (!trimmed) return;
    setGhLoading(true);
    try {
      const res = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${trimmed}`, Accept: 'application/vnd.github+json' },
      });
      if (!res.ok) {
        showAlert('Ongeldige token', 'Controleer je token en probeer opnieuw');
        return;
      }
      const data = await res.json();
      setGithubToken(trimmed);
      await setItem(GITHUB_TOKEN_KEY, trimmed);
      setGhUsername(data.login);
      setGhTokenInput('');
      setShowGhInput(false);
    } catch {
      showAlert('Fout', 'Kon token niet verifiëren');
    } finally {
      setGhLoading(false);
    }
  };

  const removeGhToken = () => {
    Alert.alert(
      'GitHub ontkoppelen',
      'Weet je zeker dat je je GitHub token wilt verwijderen?',
      [
        { text: 'Annuleren', style: 'cancel' },
        {
          text: 'Verwijderen',
          style: 'destructive',
          onPress: async () => {
            setGithubToken(null);
            setGhUsername(null);
            await deleteItem(GITHUB_TOKEN_KEY);
          },
        },
      ],
    );
  };

  // Logout
  const handleLogout = () => {
    Alert.alert(
      'Uitloggen',
      'Weet je zeker dat je wilt uitloggen?',
      [
        { text: 'Annuleren', style: 'cancel' },
        {
          text: 'Uitloggen',
          style: 'destructive',
          onPress: async () => {
            await logout();
            router.replace('/login' as any);
          },
        },
      ],
    );
  };

  // Kill all sessions (double confirmation)
  const killAllSessions = () => {
    Alert.alert(
      'Alle sessies sluiten',
      `Weet je zeker dat je alle ${sessions.length} sessies wilt sluiten?`,
      [
        { text: 'Annuleren', style: 'cancel' },
        {
          text: 'Ja, sluiten',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Bevestig',
              'Dit kan niet ongedaan worden. Alle actieve terminal sessies worden beëindigd.',
              [
                { text: 'Annuleren', style: 'cancel' },
                {
                  text: 'Definitief sluiten',
                  style: 'destructive',
                  onPress: async () => {
                    for (const s of sessions) {
                      try {
                        apiFetch(`/api/sessions/${s.id}`, { method: 'DELETE' }).catch(() => {});
                      } catch {}
                    }
                    setSessions([]);
                    setActiveSessionId(null);
                    showAlert('Alle sessies gesloten');
                  },
                },
              ],
            );
          },
        },
      ],
    );
  };

  // Reset local storage (double confirmation)
  const resetStorage = () => {
    Alert.alert(
      'Opslag wissen',
      'Weet je zeker dat je alle lokale gegevens wilt wissen? Je wordt uitgelogd.',
      [
        { text: 'Annuleren', style: 'cancel' },
        {
          text: 'Ja, wissen',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Bevestig',
              'Dit verwijdert je login, GitHub token, thema en alle instellingen. Dit kan niet ongedaan worden.',
              [
                { text: 'Annuleren', style: 'cancel' },
                {
                  text: 'Definitief wissen',
                  style: 'destructive',
                  onPress: async () => {
                    await Promise.all([
                      deleteItem('hussle_jwt'),
                      deleteItem('hussle_server_url'),
                      deleteItem(GITHUB_TOKEN_KEY),
                      deleteItem(ACCENT_KEY),
                      deleteItem(FONT_SIZE_KEY),
                    ]);
                    await logout();
                    router.replace('/login' as any);
                  },
                },
              ],
            );
          },
        },
      ],
    );
  };

  const maskedToken = githubToken
    ? `${githubToken.slice(0, 6)}${'•'.repeat(20)}${githubToken.slice(-4)}`
    : null;

  return (
    <ScrollView style={styles.container} scrollEnabled={scrollEnabled}>
      {/* === VERBINDING === */}
      <View style={styles.section}>
        <SectionHeader icon="server" title="VERBINDING" color={colors.blue} />
        <View style={styles.card}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Server</Text>
            <Text style={styles.infoValue} numberOfLines={1}>{serverUrl || '—'}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Status</Text>
            <View style={styles.statusRow}>
              <View style={[styles.statusDot, { backgroundColor: serverOnline === true ? colors.accent : serverOnline === false ? colors.red : colors.textDim }]} />
              <Text style={[styles.infoValue, { color: serverOnline === true ? colors.accent : serverOnline === false ? colors.red : colors.textDim }]}>
                {serverOnline === true ? 'Online' : serverOnline === false ? 'Offline' : 'Laden...'}
              </Text>
            </View>
          </View>
          {serverUptime && (
            <>
              <View style={styles.divider} />
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Uptime</Text>
                <Text style={styles.infoValue}>{serverUptime}</Text>
              </View>
            </>
          )}
          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Sessies</Text>
            <Text style={styles.infoValue}>{sessions.length} actief</Text>
          </View>
        </View>
        <TouchableOpacity style={styles.dangerBtn} onPress={handleLogout} activeOpacity={0.7}>
          <Ionicons name="log-out-outline" size={16} color={colors.red} />
          <Text style={styles.dangerBtnText}>Uitloggen</Text>
        </TouchableOpacity>
      </View>

      {/* === GITHUB === */}
      <View style={styles.section}>
        <SectionHeader icon="logo-github" title="GITHUB" color={colors.text} />
        <View style={styles.card}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Status</Text>
            <View style={styles.statusRow}>
              <View style={[styles.statusDot, { backgroundColor: githubToken ? colors.accent : colors.textDim }]} />
              <Text style={[styles.infoValue, { color: githubToken ? colors.accent : colors.textDim }]}>
                {githubToken ? 'Verbonden' : 'Niet verbonden'}
              </Text>
            </View>
          </View>
          {ghUsername && (
            <>
              <View style={styles.divider} />
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Account</Text>
                <Text style={[styles.infoValue, { color: colors.text }]}>@{ghUsername}</Text>
              </View>
            </>
          )}
          {maskedToken && (
            <>
              <View style={styles.divider} />
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Token</Text>
                <Text style={[styles.infoValue, { fontFamily: 'monospace', fontSize: fs.micro }]}>{maskedToken}</Text>
              </View>
            </>
          )}
        </View>

        {githubToken ? (
          <TouchableOpacity style={styles.dangerBtn} onPress={removeGhToken} activeOpacity={0.7}>
            <Ionicons name="trash-outline" size={16} color={colors.red} />
            <Text style={styles.dangerBtnText}>Token verwijderen</Text>
          </TouchableOpacity>
        ) : (
          <>
            {!showGhInput ? (
              <TouchableOpacity style={styles.actionBtn} onPress={() => setShowGhInput(true)} activeOpacity={0.7}>
                <Ionicons name="key-outline" size={16} color={colors.accent} />
                <Text style={styles.actionBtnText}>Token toevoegen</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.tokenInputCard}>
                <TextInput
                  style={styles.tokenInput}
                  placeholder="ghp_xxxxxxxxxxxx..."
                  placeholderTextColor={colors.textDim}
                  value={ghTokenInput}
                  onChangeText={setGhTokenInput}
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry
                />
                <View style={styles.tokenActions}>
                  <TouchableOpacity style={styles.tokenCancelBtn} onPress={() => { setShowGhInput(false); setGhTokenInput(''); }} activeOpacity={0.7}>
                    <Text style={styles.tokenCancelText}>Annuleren</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.tokenSaveBtn} onPress={saveGhToken} disabled={ghLoading || !ghTokenInput.trim()} activeOpacity={0.7}>
                    {ghLoading ? (
                      <ActivityIndicator size="small" color={colors.bg} />
                    ) : (
                      <Text style={styles.tokenSaveText}>Opslaan</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </>
        )}
      </View>

      {/* === THEMAKLEUR === */}
      <View style={styles.section}>
        <SectionHeader icon="color-palette" title="THEMAKLEUR" color={colors.purple} />
        <Text style={styles.sectionDesc}>Kies een accentkleur voor de app</Text>
        <View style={styles.colorGrid}>
          {THEME_COLORS.map((item) => (
            <TouchableOpacity
              key={item.color}
              style={[
                styles.colorOption,
                { borderColor: accentColor === item.color ? item.color : colors.borderStrong },
              ]}
              onPress={() => pickColor(item.color)}
              activeOpacity={0.7}
            >
              <View style={[styles.colorSwatch, { backgroundColor: item.color }]}>
                {accentColor === item.color && (
                  <Ionicons name="checkmark" size={20} color={colors.bg} />
                )}
              </View>
              <Text style={[styles.colorLabel, accentColor === item.color && { color: item.color }]}>
                {item.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Custom color picker */}
        <TouchableOpacity
          style={styles.pickerToggle}
          onPress={() => setPickerOpen(!pickerOpen)}
          activeOpacity={0.7}
        >
          <View style={styles.pickerToggleLeft}>
            <View style={[styles.pickerDot, { backgroundColor: accentColor }]} />
            <Text style={styles.pickerToggleText}>Eigen kleur kiezen</Text>
          </View>
          <Ionicons name={pickerOpen ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
        </TouchableOpacity>

        {pickerOpen && (
          <View style={styles.pickerContainer}>
            <View style={styles.pickerPreview}>
              <View style={[styles.pickerPreviewSwatch, { backgroundColor: accentColor }]} />
              <Text style={styles.pickerPreviewHex}>{accentColor.toUpperCase()}</Text>
            </View>

            <ColorSlider
              value={hue / 360}
              onValueChange={onHueChange}
              onSlideStart={onSlideStart}
              onSlideEnd={onSlideEnd}
              gradientColors={hueStops}
              label="Tint"
              displayValue={`${hue}°`}
            />
            <ColorSlider
              value={sat / 100}
              onValueChange={onSatChange}
              onSlideStart={onSlideStart}
              onSlideEnd={onSlideEnd}
              gradientColors={satStops}
              label="Verzadiging"
              displayValue={`${sat}%`}
            />
            <ColorSlider
              value={lit / 100}
              onValueChange={onLitChange}
              onSlideStart={onSlideStart}
              onSlideEnd={onSlideEnd}
              gradientColors={litStops}
              label="Helderheid"
              displayValue={`${lit}%`}
            />
          </View>
        )}
      </View>

      {/* === TERMINAL === */}
      <View style={styles.section}>
        <SectionHeader icon="terminal" title="TERMINAL" color={colors.accent} />
        <Text style={styles.sectionDesc}>Lettergrootte voor terminal tekst</Text>
        <View style={styles.fontSizeRow}>
          {FONT_SIZES.map((item) => (
            <TouchableOpacity
              key={item.size}
              style={[
                styles.fontSizeBtn,
                terminalFontSize === item.size && { borderColor: colors.accent, backgroundColor: colors.accent + '15' },
              ]}
              onPress={() => selectFontSize(item.size)}
              activeOpacity={0.7}
            >
              <Text style={[
                styles.fontSizeBtnLabel,
                terminalFontSize === item.size && { color: colors.accent },
              ]}>
                {item.label}
              </Text>
              <Text style={[
                styles.fontSizeBtnSize,
                terminalFontSize === item.size && { color: colors.accent },
              ]}>
                {item.size}px
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={styles.fontPreview}>
          <Text style={[styles.fontPreviewText, { fontSize: terminalFontSize }]}>
            $ hussle --version{'\n'}Hussle Terminal v1.0.0
          </Text>
        </View>
      </View>

      {/* === GEGEVENS === */}
      <View style={styles.section}>
        <SectionHeader icon="shield" title="GEGEVENS" color={colors.yellow} />
        <TouchableOpacity
          style={[styles.dangerBtn, sessions.length === 0 && styles.disabledBtn]}
          onPress={killAllSessions}
          disabled={sessions.length === 0}
          activeOpacity={0.7}
        >
          <Ionicons name="close-circle-outline" size={16} color={sessions.length > 0 ? colors.red : colors.textDim} />
          <Text style={[styles.dangerBtnText, sessions.length === 0 && { color: colors.textDim }]}>
            Alle sessies sluiten ({sessions.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.dangerBtn} onPress={resetStorage} activeOpacity={0.7}>
          <Ionicons name="trash-outline" size={16} color={colors.red} />
          <Text style={styles.dangerBtnText}>Alle lokale gegevens wissen</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.dangerBtn, { borderColor: accentColor + '40' }]}
          onPress={() => useStore.getState().setShowSplash(true)}
          activeOpacity={0.7}
        >
          <Ionicons name="refresh-outline" size={16} color={accentColor} />
          <Text style={[styles.dangerBtnText, { color: accentColor }]}>Test splash screen</Text>
        </TouchableOpacity>
      </View>

      {/* === OVER === */}
      <View style={[styles.section, { marginBottom: 60 }]}>
        <SectionHeader icon="information-circle" title="OVER" color={colors.textMuted} />
        <View style={styles.card}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>App</Text>
            <Text style={styles.infoValue}>Hussle Terminal</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Versie</Text>
            <Text style={styles.infoValue}>1.0.0</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Build</Text>
            <Text style={[styles.infoValue, { fontFamily: 'monospace' }]}>2026.03</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>SDK</Text>
            <Text style={styles.infoValue}>Expo 54</Text>
          </View>
        </View>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => setShowSplash(true)}
          activeOpacity={0.7}
        >
          <Ionicons name="play-outline" size={16} color={colors.accent} />
          <Text style={styles.actionBtnText}>Splash testen</Text>
        </TouchableOpacity>
        <Text style={styles.copyright}>© 2026 Magmoet. Alle rechten voorbehouden.</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: spacing.lg,
  },
  section: {
    marginBottom: 28,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  sectionTitle: {
    color: colors.textMuted,
    fontSize: fs.micro,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  sectionDesc: {
    color: colors.textDim,
    fontSize: fs.caption,
    marginBottom: spacing.md,
  },

  // Card
  card: {
    backgroundColor: colors.elevated,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    overflow: 'hidden',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  infoLabel: {
    color: colors.textMuted,
    fontSize: fs.standard,
  },
  infoValue: {
    color: colors.textSecondary,
    fontSize: fs.standard,
    flex: 1,
    textAlign: 'right',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    flex: 1,
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginHorizontal: spacing.lg,
  },

  // Buttons
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.elevated,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.accent + '40',
    paddingVertical: spacing.md,
    marginTop: spacing.md,
  },
  actionBtnText: {
    color: colors.accent,
    fontSize: fs.standard,
    fontWeight: '600',
  },
  dangerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.elevated,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.red + '30',
    paddingVertical: spacing.md,
    marginTop: spacing.md,
  },
  dangerBtnText: {
    color: colors.red,
    fontSize: fs.standard,
    fontWeight: '600',
  },
  disabledBtn: {
    borderColor: colors.borderStrong,
    opacity: 0.5,
  },

  // GitHub token input
  tokenInputCard: {
    backgroundColor: colors.elevated,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  tokenInput: {
    backgroundColor: colors.surface,
    color: colors.text,
    borderRadius: radius.sm,
    padding: spacing.md,
    fontSize: fs.standard,
    fontFamily: 'monospace',
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  tokenActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  tokenCancelBtn: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.sm,
  },
  tokenCancelText: {
    color: colors.textMuted,
    fontSize: fs.standard,
    fontWeight: '600',
  },
  tokenSaveBtn: {
    backgroundColor: colors.accent,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.sm,
    minWidth: 80,
    alignItems: 'center',
  },
  tokenSaveText: {
    color: colors.bg,
    fontSize: fs.standard,
    fontWeight: '700',
  },

  // Color grid
  colorGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  colorOption: {
    alignItems: 'center',
    borderWidth: 2,
    borderRadius: radius.md,
    padding: spacing.md,
    width: 90,
  },
  colorSwatch: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  colorLabel: {
    color: colors.textMuted,
    fontSize: fs.caption,
    fontWeight: '500',
  },

  // Custom picker
  pickerToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
    paddingVertical: spacing.md,
  },
  pickerToggleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  pickerDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  pickerToggleText: {
    color: colors.textSecondary,
    fontSize: fs.standard,
    fontWeight: '600',
  },
  pickerContainer: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  pickerPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  pickerPreviewSwatch: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: colors.borderStrong,
  },
  pickerPreviewHex: {
    color: colors.text,
    fontSize: fs.header,
    fontWeight: '700',
    fontFamily: 'monospace',
  },

  // Font size
  fontSizeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  fontSizeBtn: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: colors.elevated,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingVertical: spacing.md,
  },
  fontSizeBtnLabel: {
    color: colors.textSecondary,
    fontSize: fs.standard,
    fontWeight: '700',
  },
  fontSizeBtnSize: {
    color: colors.textDim,
    fontSize: fs.micro,
    marginTop: 2,
  },
  fontPreview: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  fontPreviewText: {
    color: colors.accent,
    fontFamily: 'monospace',
    lineHeight: 22,
  },

  // Footer
  copyright: {
    color: colors.textDim,
    fontSize: fs.micro,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
});
