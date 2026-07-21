import React, { useRef, useState, useCallback, useEffect, forwardRef, useImperativeHandle } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  PanResponder,
  Dimensions,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Keyboard,
  TextInput,
} from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useApi } from '../hooks/useApi';
import { useWebSocket } from '../hooks/useWebSocket';
import { useStore } from '../store';

const SCREEN_HEIGHT = Dimensions.get('window').height;
const MIN_HEIGHT = 180;
const MAX_HEIGHT = SCREEN_HEIGHT * 0.85;
const DEFAULT_HEIGHT = SCREEN_HEIGHT * 0.4;
const SNAP_POINTS = [MIN_HEIGHT, DEFAULT_HEIGHT, SCREEN_HEIGHT * 0.65, MAX_HEIGHT];

function snapTo(value: number): number {
  let closest = SNAP_POINTS[0];
  let minDist = Math.abs(value - closest);
  for (const p of SNAP_POINTS) {
    const dist = Math.abs(value - p);
    if (dist < minDist) {
      minDist = dist;
      closest = p;
    }
  }
  return closest;
}

const XTERM_HTML = `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm@5/css/xterm.min.css">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; background: #0a0a0a; overflow: hidden; }
    #wrap { position: relative; width: 100%; height: 100%; }
    #terminal { width: 100%; height: 100%; }
    .xterm { padding: 4px; }
    .xterm-viewport { overflow: hidden !important; }
    .xterm-helper-textarea { display: none !important; }
    #overlay {
      position: absolute; top: 0; left: 0; right: 0; bottom: 0;
      z-index: 100; touch-action: none;
    }
  </style>
</head>
<body>
  <div id="wrap">
    <div id="terminal"></div>
    <div id="overlay"></div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/@xterm/xterm@5/lib/xterm.min.js"><\/script>
  <script src="https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0/lib/addon-fit.min.js"><\/script>
  <script>
    try {
    const term = new Terminal({
      theme: {
        background: '#0a0a0a',
        foreground: '#e0e0e0',
        cursor: '#e0e0e0',
        selectionBackground: '#354a5f',
      },
      fontSize: 12,
      fontFamily: 'Menlo, Monaco, Courier New, monospace',
      cursorBlink: true,
      convertEol: true,
      scrollback: 10000,
      scrollOnUserInput: true,
    });

    const fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(document.getElementById('terminal'));

    let fitTimer;
    function debouncedFit() {
      clearTimeout(fitTimer);
      fitTimer = setTimeout(() => {
        try {
          fitAddon.fit();
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'resize', cols: term.cols, rows: term.rows,
          }));
        } catch(e) {}
      }, 150);
    }
    debouncedFit();
    new ResizeObserver(debouncedFit).observe(document.getElementById('terminal'));

    const overlay = document.getElementById('overlay');
    const LINE_HEIGHT = 17;
    const FRICTION = 0.93;
    const MIN_VEL = 0.2;
    const TAP_THRESHOLD = 15;

    let startY, startX, lastY, lastTime, isSwiping, momentumId;
    let velocityY = 0, scrollAcc = 0;
    let samples = [];

    function stopMomentum() {
      if (momentumId) { cancelAnimationFrame(momentumId); momentumId = null; }
      velocityY = 0; scrollAcc = 0; samples = [];
    }

    function scrollPx(px) {
      scrollAcc += px / LINE_HEIGHT;
      const lines = Math.trunc(scrollAcc);
      if (lines !== 0) { term.scrollLines(lines); scrollAcc -= lines; }
    }

    function glide() {
      if (Math.abs(velocityY) < MIN_VEL) { momentumId = null; scrollAcc = 0; return; }
      scrollPx(velocityY);
      velocityY *= FRICTION;
      momentumId = requestAnimationFrame(glide);
    }

    overlay.addEventListener('touchstart', (e) => {
      e.preventDefault();
      stopMomentum();
      const t = e.touches[0];
      startY = lastY = t.clientY;
      startX = t.clientX;
      lastTime = performance.now();
      isSwiping = false;
    });

    overlay.addEventListener('touchmove', (e) => {
      e.preventDefault();
      const t = e.touches[0];
      const now = performance.now();
      const dy = lastY - t.clientY;
      const dt = now - lastTime;

      if (!isSwiping) {
        if (Math.abs(t.clientY - startY) > TAP_THRESHOLD || Math.abs(t.clientX - startX) > TAP_THRESHOLD) {
          isSwiping = true;
        }
      }

      if (isSwiping && dt > 0) {
        scrollPx(dy);
        samples.push({ v: dy / dt, t: now });
        while (samples.length > 0 && now - samples[0].t > 100) samples.shift();
      }

      lastY = t.clientY;
      lastTime = now;
    });

    overlay.addEventListener('touchend', (e) => {
      e.preventDefault();
      if (!isSwiping) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'focusInput' }));
        return;
      }
      if (samples.length >= 2) {
        let sum = 0;
        for (const s of samples) sum += s.v;
        velocityY = (sum / samples.length) * 16;
        if (Math.abs(velocityY) > MIN_VEL) {
          momentumId = requestAnimationFrame(glide);
        }
      }
      samples = [];
    });

    // --- Scroll position tracking ---
    let isAtBottom = true;
    term.onScroll(() => {
      const buf = term.buffer.active;
      const atBottom = buf.viewportY >= buf.baseY;
      if (atBottom !== isAtBottom) {
        isAtBottom = atBottom;
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'scrollState', atBottom: isAtBottom,
        }));
      }
    });

    term.onData((data) => {
      try {
        isAtBottom = true;
        term.scrollToBottom();
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'input', data }));
      } catch(e) {}
    });

    window.writeTerminal = (data) => {
      try {
        const shouldScroll = isAtBottom;
        term.write(data, () => {
          if (shouldScroll) {
            term.scrollToBottom();
          }
        });
      } catch(e) {}
    };
    window.clearTerminal = () => { try { term.clear(); } catch(e) {} };
    window.scrollToBottom = () => { try { term.scrollToBottom(); } catch(e) {} };

    } catch(e) {
      document.body.innerText = 'Terminal error: ' + e.message;
    }
  <\/script>
</body>
</html>
`;

export interface GitTerminalHandle {
  runCommand: (cmd: string) => void;
}

interface Props {
  projectPath: string;
  visible: boolean;
  onClose: () => void;
}

const GitTerminal = forwardRef<GitTerminalHandle, Props>(({ projectPath, visible, onClose }, ref) => {
  const { apiFetch } = useApi();
  const { sessions, addSession } = useStore();
  const webViewRef = useRef<WebView>(null);
  const inputRef = useRef<TextInput>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const btnOpacity = useRef(new Animated.Value(0)).current;
  const [panelHeight] = useState(() => new Animated.Value(DEFAULT_HEIGHT));
  const currentHeight = useRef(DEFAULT_HEIGHT);

  useEffect(() => {
    Animated.timing(btnOpacity, {
      toValue: showScrollBtn ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [showScrollBtn]);

  const initSession = useCallback(async () => {
    const existing = sessions.find(s => s.active && s.workdir === projectPath);
    if (existing) {
      setSessionId(existing.id);
      return;
    }

    setConnecting(true);
    try {
      const session = await apiFetch('/api/sessions', {
        method: 'POST',
        body: JSON.stringify({ workdir: projectPath }),
      });
      addSession(session);
      setSessionId(session.id);
    } catch (err: any) {
      console.error('Failed to create session:', err.message);
    } finally {
      setConnecting(false);
    }
  }, [projectPath, sessions, apiFetch, addSession]);

  const handleWsMessage = useCallback(
    (msg: any) => {
      if (msg.type === 'terminal/output' && msg.sessionId === sessionId) {
        const escaped = JSON.stringify(msg.data);
        webViewRef.current?.injectJavaScript(`window.writeTerminal(${escaped}); true;`);
      }
    },
    [sessionId],
  );

  const { sendInput, subscribe, resize } = useWebSocket(handleWsMessage);

  useImperativeHandle(ref, () => ({
    runCommand: (cmd: string) => {
      if (sessionId) {
        sendInput(sessionId, cmd + '\r');
      }
    },
  }), [sessionId, sendInput]);

  useEffect(() => {
    if (sessionId && visible) {
      webViewRef.current?.injectJavaScript(`window.clearTerminal(); true;`);
      subscribe(sessionId);
    }
  }, [sessionId, visible, subscribe]);

  useEffect(() => {
    if (visible && !sessionId) {
      initSession();
    }
  }, [visible, sessionId, initSession]);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      try {
        const msg = JSON.parse(event.nativeEvent.data);
        if (msg.type === 'input' && sessionId) {
          sendInput(sessionId, msg.data);
        } else if (msg.type === 'resize' && sessionId) {
          resize(sessionId, msg.cols, msg.rows);
        } else if (msg.type === 'scrollState') {
          setShowScrollBtn(!msg.atBottom);
        } else if (msg.type === 'focusInput') {
          inputRef.current?.focus();
        }
      } catch {}
    },
    [sessionId, sendInput, resize],
  );

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (_, gesture) => {
        const newHeight = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, currentHeight.current - gesture.dy));
        panelHeight.setValue(newHeight);
      },
      onPanResponderRelease: (_, gesture) => {
        const rawHeight = currentHeight.current - gesture.dy;
        if (rawHeight < MIN_HEIGHT * 0.6) {
          onClose();
          currentHeight.current = DEFAULT_HEIGHT;
          panelHeight.setValue(DEFAULT_HEIGHT);
          return;
        }
        const snapped = snapTo(rawHeight);
        currentHeight.current = snapped;
        Animated.spring(panelHeight, {
          toValue: snapped,
          useNativeDriver: false,
          tension: 80,
          friction: 12,
        }).start();
      },
    }),
  ).current;

  const scrollToBottom = useCallback(() => {
    webViewRef.current?.injectJavaScript(`window.scrollToBottom(); true;`);
    setShowScrollBtn(false);
  }, []);

  const SENTINEL = ' ';
  const [inputValue, setInputValue] = useState(SENTINEL);
  const backspaceTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const toolbarScrolling = useRef(false);

  const startBackspace = useCallback(() => {
    if (backspaceTimer.current) return;
    if (sessionId) sendInput(sessionId, '\x7f');
    backspaceTimer.current = setInterval(() => {
      if (sessionId) sendInput(sessionId, '\x7f');
    }, 80);
  }, [sessionId, sendInput]);

  const stopBackspace = useCallback(() => {
    if (backspaceTimer.current) {
      clearInterval(backspaceTimer.current);
      backspaceTimer.current = null;
    }
  }, []);

  const repeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const sendKey = useCallback((key: string) => {
    if (toolbarScrolling.current) return;
    if (sessionId) sendInput(sessionId, key);
  }, [sessionId, sendInput]);

  const repeatDelay = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startRepeat = useCallback((key: string) => {
    if (repeatTimer.current || repeatDelay.current) return;
    if (sessionId) sendInput(sessionId, key);
    repeatDelay.current = setTimeout(() => {
      repeatDelay.current = null;
      repeatTimer.current = setInterval(() => {
        if (sessionId) sendInput(sessionId, key);
      }, 80);
    }, 750);
  }, [sessionId, sendInput]);

  const stopRepeat = useCallback(() => {
    if (repeatDelay.current) {
      clearTimeout(repeatDelay.current);
      repeatDelay.current = null;
    }
    if (repeatTimer.current) {
      clearInterval(repeatTimer.current);
      repeatTimer.current = null;
    }
  }, []);

  useEffect(() => {
    return () => { stopRepeat(); stopBackspace(); };
  }, [stopRepeat, stopBackspace]);

  const pasteFromClipboard = useCallback(async () => {
    if (toolbarScrolling.current) return;
    const text = await Clipboard.getStringAsync();
    if (text && sessionId) sendInput(sessionId, text);
  }, [sessionId, sendInput]);

  if (!visible) return null;

  const activeSession = sessions.find(s => s.id === sessionId);

  return (
    <Animated.View style={[styles.panel, { height: panelHeight }]}>
      <View {...panResponder.panHandlers} style={styles.dragArea}>
        <View style={styles.dragHandle} />
      </View>

      <View style={styles.header}>
        <View style={[styles.dot, { backgroundColor: activeSession?.active ? '#4ade80' : '#555' }]} />
        <Ionicons name="terminal" size={14} color="#4ade80" />
        <Text style={styles.headerTitle} numberOfLines={1}>
          {activeSession?.title || 'Terminal'}
        </Text>
        <Text style={styles.headerPath} numberOfLines={1}>
          {projectPath.split(/[\\/]/).pop()}
        </Text>
        <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-down" size={20} color="#888" />
        </TouchableOpacity>
      </View>

      {/* Shortcut toolbar */}
      <View style={styles.toolbar}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.toolbarContent}
        keyboardShouldPersistTaps="always"
        nestedScrollEnabled
        onScrollBeginDrag={() => { toolbarScrolling.current = true; }}
        onScrollEndDrag={() => {
          setTimeout(() => { toolbarScrolling.current = false; }, 200);
        }}
        onMomentumScrollEnd={() => {
          toolbarScrolling.current = false;
        }}
      >
        <TouchableOpacity style={[styles.toolbarBtn, styles.enterBtn]} onPress={() => sendKey('\r')} activeOpacity={0.6}>
          <Ionicons name="return-down-back" size={14} color="#4ade80" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.toolbarBtn} onPress={() => sendKey('\x1b')} activeOpacity={0.6}>
          <Text style={styles.toolbarBtnText}>ESC</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.toolbarBtn, styles.ctrlCBtn]} onPress={() => sendKey('\x03')} activeOpacity={0.6}>
          <Text style={styles.ctrlCBtnText}>Ctrl+C</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.toolbarBtn} onPress={() => sendKey('\t')} activeOpacity={0.6}>
          <Text style={styles.toolbarBtnText}>TAB</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.toolbarBtn} onPress={() => sendKey('\x1b[Z')} activeOpacity={0.6}>
          <Text style={styles.toolbarBtnText}>⇧TAB</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.toolbarBtn} onPress={() => sendKey('\x04')} activeOpacity={0.6}>
          <Text style={styles.toolbarBtnText}>Ctrl+D</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.toolbarBtn} onPress={() => sendKey('\x1a')} activeOpacity={0.6}>
          <Text style={styles.toolbarBtnText}>Ctrl+Z</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.toolbarBtn} onPress={() => sendKey('\x01')} activeOpacity={0.6}>
          <Text style={styles.toolbarBtnText}>Ctrl+A</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.toolbarBtn} onPress={() => sendKey('\x18')} activeOpacity={0.6}>
          <Text style={styles.toolbarBtnText}>Ctrl+X</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.toolbarBtn} onPress={pasteFromClipboard} activeOpacity={0.6}>
          <Text style={styles.toolbarBtnText}>Plak</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.toolbarBtn} onPressIn={() => startRepeat('\x1b[D')} onPressOut={stopRepeat} activeOpacity={0.6}>
          <Ionicons name="arrow-back" size={14} color="#aaa" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.toolbarBtn} onPressIn={() => startRepeat('\x1b[C')} onPressOut={stopRepeat} activeOpacity={0.6}>
          <Ionicons name="arrow-forward" size={14} color="#aaa" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.toolbarBtn} onPressIn={() => startRepeat('\x1b[A')} onPressOut={stopRepeat} activeOpacity={0.6}>
          <Ionicons name="arrow-up" size={14} color="#aaa" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.toolbarBtn} onPressIn={() => startRepeat('\x1b[B')} onPressOut={stopRepeat} activeOpacity={0.6}>
          <Ionicons name="arrow-down" size={14} color="#aaa" />
        </TouchableOpacity>
      </ScrollView>
        <TouchableOpacity
          style={styles.dismissBtn}
          onPress={() => { Keyboard.dismiss(); inputRef.current?.blur(); }}
          activeOpacity={0.6}
        >
          <Ionicons name="chevron-down-outline" size={16} color="#888" />
        </TouchableOpacity>
      </View>

      <TextInput
        ref={inputRef}
        style={styles.hiddenInput}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        spellCheck={false}
        caretHidden
        keyboardAppearance="dark"
        blurOnSubmit={false}
        returnKeyType="send"
        value={inputValue}
        selection={{ start: 1, end: 1 }}
        onChangeText={(text) => {
          stopBackspace();
          if (text.length > SENTINEL.length) {
            const typed = text.slice(SENTINEL.length);
            if (sessionId) sendInput(sessionId, typed);
          } else if (text.length < SENTINEL.length) {
            if (sessionId) sendInput(sessionId, '\x7f');
          }
          setInputValue(SENTINEL);
        }}
        onKeyPress={({ nativeEvent }) => {
          if (nativeEvent.key === 'Backspace') startBackspace();
        }}
        onSubmitEditing={() => {
          stopBackspace();
          if (sessionId) sendInput(sessionId, '\r');
          setInputValue(SENTINEL);
        }}
      />

      <View style={{ flex: 1, position: 'relative' }}>
        {connecting ? (
          <View style={styles.loading}>
            <ActivityIndicator color="#4ade80" />
            <Text style={styles.loadingText}>Sessie starten...</Text>
          </View>
        ) : (
          <WebView
            ref={webViewRef}
            source={{ html: XTERM_HTML }}
            style={styles.webview}
            javaScriptEnabled
            onMessage={handleMessage}
            scrollEnabled={false}
            bounces={false}
            overScrollMode="never"
            hideKeyboardAccessoryView
            onError={() => {}}
            onHttpError={() => {}}
          />
        )}
        <Animated.View style={[styles.scrollBtnWrap, { opacity: btnOpacity }]} pointerEvents={showScrollBtn ? 'box-none' : 'none'}>
          <TouchableOpacity style={styles.scrollBtn} onPress={scrollToBottom} activeOpacity={0.8}>
            <Ionicons name="arrow-down" size={16} color="#0a0a0a" />
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Animated.View>
  );
});

export default GitTerminal;

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#0a0a0a',
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    borderTopWidth: 1,
    borderColor: '#2a2a2a',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 16,
  },
  dragArea: {
    alignItems: 'center',
    paddingVertical: 8,
    backgroundColor: '#111',
  },
  dragHandle: {
    width: 36,
    height: 4,
    backgroundColor: '#444',
    borderRadius: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#111',
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  headerTitle: {
    color: '#e0e0e0',
    fontSize: 12,
    fontWeight: '600',
  },
  headerPath: {
    color: '#555',
    fontSize: 11,
    fontFamily: 'monospace',
    flex: 1,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111',
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  dismissBtn: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  toolbarContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  toolbarBtn: {
    backgroundColor: '#1a1a1a',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    marginRight: 6,
  },
  toolbarBtnText: {
    color: '#aaa',
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  enterBtn: {
    backgroundColor: '#0a2a0a',
    borderColor: '#1a4a1a',
  },
  ctrlCBtn: {
    backgroundColor: '#2a1010',
    borderColor: '#5a2020',
  },
  ctrlCBtnText: {
    color: '#f87171',
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  loadingText: {
    color: '#666',
    fontSize: 12,
  },
  hiddenInput: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 1,
    height: 1,
    opacity: 0,
    zIndex: -1,
  },
  webview: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  scrollBtnWrap: {
    position: 'absolute',
    bottom: 10,
    right: 10,
  },
  scrollBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#4ade80',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 6,
  },
});
