import React, { useRef, useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Keyboard, ScrollView, TextInput } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';

interface Props {
  onInput: (data: string) => void;
  onResize?: (cols: number, rows: number) => void;
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
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      z-index: 100; touch-action: none;
    }
  </style>
</head>
<body>
  <div id="wrap">
    <div id="terminal"></div>
    <div id="overlay"></div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/@xterm/xterm@5/lib/xterm.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0/lib/addon-fit.min.js"></script>
  <script>
    try {
    const term = new Terminal({
      theme: {
        background: '#0a0a0a',
        foreground: '#e0e0e0',
        cursor: '#e0e0e0',
        selectionBackground: '#354a5f',
      },
      fontSize: 13,
      fontFamily: 'Menlo, Monaco, Courier New, monospace',
      cursorBlink: true,
      convertEol: true,
      scrollback: 10000,
      scrollOnUserInput: false,
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

    // --- Touch overlay for scrolling ---
    const overlay = document.getElementById('overlay');
    const LINE_HEIGHT = 17;
    const FRICTION = 0.93;
    const MIN_VEL = 0.2;
    const TAP_THRESHOLD = 10;

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
      stopMomentum();
      const t = e.touches[0];
      startY = lastY = t.clientY;
      startX = t.clientX;
      lastTime = Date.now();
      isSwiping = false;
      samples = [];
    }, { passive: true });

    overlay.addEventListener('touchmove', (e) => {
      const t = e.touches[0];
      const dy = lastY - t.clientY;
      const now = Date.now();
      if (!isSwiping) {
        const totalDy = Math.abs(t.clientY - startY);
        const totalDx = Math.abs(t.clientX - startX);
        if (totalDy > TAP_THRESHOLD && totalDy > totalDx) isSwiping = true;
        else return;
      }
      scrollPx(dy);
      samples.push({ v: dy / Math.max(now - lastTime, 1) * 16, t: now });
      if (samples.length > 5) samples.shift();
      lastY = t.clientY;
      lastTime = now;
      e.preventDefault();
    }, { passive: false });

    overlay.addEventListener('touchend', (e) => {
      if (!isSwiping) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'focusInput' }));
        return;
      }
      const now = Date.now();
      const recent = samples.filter(s => now - s.t < 100);
      if (recent.length > 0) {
        velocityY = recent.reduce((a, s) => a + s.v, 0) / recent.length;
        if (Math.abs(velocityY) > MIN_VEL) momentumId = requestAnimationFrame(glide);
      }
    }, { passive: true });

    window.scrollLines = (n) => { try { term.scrollLines(n); } catch(e) {} };
    window.focusTerm = () => { try { term.focus(); } catch(e) {} };

    // Terminal I/O
    term.onData((data) => {
      try {
        if (isAtBottom) {
          term.scrollToBottom();
        }
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
    window.scrollToBottom = () => { try { term.scrollToBottom(); isAtBottom = true; window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'scrollState', atBottom: true })); } catch(e) {} };

    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ready' }));
    } catch(e) {
      document.body.innerText = 'Terminal error: ' + e.message;
      document.body.style.color = '#f87171';
      document.body.style.padding = '20px';
      document.body.style.fontFamily = 'monospace';
    }
  </script>
</body>
</html>
`;

export default function TerminalWebView({ onInput, onResize }: Props) {
  const webViewRef = useRef<WebView>(null);
  const inputRef = useRef<TextInput>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const btnOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardWillShow', (e) => {
      setKeyboardHeight(e.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener('keyboardWillHide', () => {
      setKeyboardHeight(0);
    });
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  useEffect(() => {
    Animated.timing(btnOpacity, {
      toValue: showScrollBtn ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [showScrollBtn]);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      try {
        const msg = JSON.parse(event.nativeEvent.data);
        if (msg.type === 'input') {
          onInput(msg.data);
        } else if (msg.type === 'resize' && onResize) {
          onResize(msg.cols, msg.rows);
        } else if (msg.type === 'scrollState') {
          setShowScrollBtn(!msg.atBottom);
        } else if (msg.type === 'focusInput') {
          inputRef.current?.focus();
        } else if (msg.type === 'ready') {
          console.log('[Terminal] WebView ready');
        }
      } catch {}
    },
    [onInput, onResize],
  );

  const scrollToBottom = useCallback(() => {
    webViewRef.current?.injectJavaScript(`window.scrollToBottom(); true;`);
    setShowScrollBtn(false);
  }, []);

  const SENTINEL = ' ';
  const [inputValue, setInputValue] = useState(SENTINEL);
  const toolbarScrolling = useRef(false);

  const repeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const sendKey = useCallback((key: string) => {
    if (toolbarScrolling.current) return;
    onInput(key);
  }, [onInput]);

  const repeatDelay = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startRepeat = useCallback((key: string) => {
    if (repeatTimer.current || repeatDelay.current) return;
    onInput(key);
    repeatDelay.current = setTimeout(() => {
      repeatDelay.current = null;
      repeatTimer.current = setInterval(() => onInput(key), 80);
    }, 750);
  }, [onInput]);

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
    return () => { stopRepeat(); };
  }, [stopRepeat]);

  const pasteFromClipboard = useCallback(async () => {
    if (toolbarScrolling.current) return;
    const text = await Clipboard.getStringAsync();
    if (text) onInput(text);
  }, [onInput]);

  const write = useCallback((data: string) => {
    const escaped = JSON.stringify(data);
    webViewRef.current?.injectJavaScript(`window.writeTerminal(${escaped}); true;`);
  }, []);

  const clear = useCallback(() => {
    webViewRef.current?.injectJavaScript(`window.clearTerminal(); true;`);
  }, []);

  useEffect(() => {
    (TerminalWebView as any)._write = write;
    (TerminalWebView as any)._clear = clear;
  }, [write, clear]);

  return (
    <View style={[styles.wrapper, { marginBottom: keyboardHeight }]}>
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
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustsScrollIndicatorInsets={false}
        onError={() => {}}
        onHttpError={() => {}}
      />

      <Animated.View style={[styles.scrollBtnWrap, { opacity: btnOpacity }]} pointerEvents={showScrollBtn ? 'box-none' : 'none'}>
        <TouchableOpacity
          style={styles.scrollBtn}
          onPress={scrollToBottom}
          activeOpacity={0.8}
        >
          <Ionicons name="arrow-down" size={22} color="#0a0a0a" />
        </TouchableOpacity>
      </Animated.View>

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
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        spellCheck={false}
        keyboardAppearance="dark"
        blurOnSubmit={false}
        returnKeyType="send"
        value={inputValue}
        selection={{ start: 1, end: 1 }}
        caretHidden
        style={styles.hiddenInput}
        onChangeText={(text) => {
          if (text.length > SENTINEL.length) {
            const typed = text.slice(SENTINEL.length);
            onInput(typed);
          } else if (text.length < SENTINEL.length) {
            onInput('\x7f');
          }
          setInputValue(SENTINEL);
        }}
        onSubmitEditing={() => {
          onInput('\r');
          setInputValue(SENTINEL);
        }}
      />
    </View>
  );
}

TerminalWebView.write = (data: string) => {
  (TerminalWebView as any)._write?.(data);
};

TerminalWebView.clear = () => {
  (TerminalWebView as any)._clear?.();
};

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    position: 'relative',
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111',
    borderTopWidth: 1,
    borderTopColor: '#1a1a1a',
  },
  dismissBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  toolbarContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  toolbarBtn: {
    backgroundColor: '#1a1a1a',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    marginRight: 6,
  },
  toolbarBtnText: {
    color: '#aaa',
    fontSize: 11,
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
    fontSize: 11,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  webview: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  scrollBtnWrap: {
    position: 'absolute',
    bottom: 16,
    right: 16,
  },
  scrollBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#4ade80',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 6,
  },
  hiddenInput: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  },
});
