import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Modal,
  ActivityIndicator,
  FlatList,
  ScrollView,
  Keyboard,
} from 'react-native';
import { showAlert } from '../../utils/alert';
import { downloadFile } from '../../utils/downloadFile';
import { Ionicons } from '@expo/vector-icons';
import FileTree, { FileItem } from '../../components/FileTree';
import CodeEditor, { CodeEditorRef } from '../../components/CodeEditor';
import EditorTerminal from '../../components/EditorTerminal';
import { useApi } from '../../hooks/useApi';
import { useStore } from '../../store';

type ViewMode = 'browse' | 'tree' | 'editor';

interface DirEntry {
  name: string;
  path: string;
}

export default function EditorTab() {
  const { apiFetch } = useApi();
  const {
    accentColor,
    serverUrl,
    token,
    editorProjectPath: storedProjectPath,
    editorCurrentDir: storedCurrentDir,
    editorOpenFile: storedOpenFile,
    editorMode: storedMode,
    setEditorProjectPath,
    setEditorCurrentDir,
    setEditorOpenFile,
    setEditorMode,
  } = useStore();

  // Project selection
  const [mode, _setMode] = useState<ViewMode>(storedMode);
  const [projectPath, _setProjectPath] = useState<string | null>(storedProjectPath);
  const [browsePath, setBrowsePath] = useState('');
  const [browseDirs, setBrowseDirs] = useState<DirEntry[]>([]);
  const [browseLoading, setBrowseLoading] = useState(false);

  // File tree
  const [currentDir, _setCurrentDir] = useState(storedCurrentDir);
  const [items, setItems] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);

  // Editor
  const editorRef = useRef<CodeEditorRef>(null);
  const [openFile, _setOpenFile] = useState<{ path: string; name: string; language: string } | null>(storedOpenFile);
  const [fileContent, setFileContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [saving, setSaving] = useState(false);

  // Wrappers that sync to store
  const setMode = useCallback((m: ViewMode) => { _setMode(m); setEditorMode(m); }, [setEditorMode]);
  const setProjectPath = useCallback((p: string | null) => { _setProjectPath(p); setEditorProjectPath(p); }, [setEditorProjectPath]);
  const setCurrentDir = useCallback((d: string) => { _setCurrentDir(d); setEditorCurrentDir(d); }, [setEditorCurrentDir]);
  const setOpenFile = useCallback((f: { path: string; name: string; language: string } | null) => { _setOpenFile(f); setEditorOpenFile(f); }, [setEditorOpenFile]);

  // Terminal — open by default like agents editor
  const [showTerminal, setShowTerminal] = useState(false);

  // Create dialog
  const [showCreate, setShowCreate] = useState(false);
  const [createType, setCreateType] = useState<'file' | 'folder'>('file');
  const [createName, setCreateName] = useState('');

  // Context menu (3 dots)
  const [contextItem, setContextItem] = useState<FileItem | null>(null);

  // Download state
  const [downloadingPath, setDownloadingPath] = useState<string | null>(null);

  // Rename dialog
  const [showRename, setShowRename] = useState(false);
  const [renameTarget, setRenameTarget] = useState<FileItem | null>(null);
  const [renameName, setRenameName] = useState('');

  // Browse directories
  const loadBrowse = useCallback(async (dirPath: string) => {
    setBrowseLoading(true);
    try {
      const data = await apiFetch(`/api/files/browse?path=${encodeURIComponent(dirPath)}`);
      setBrowseDirs(data.dirs || []);
      setBrowsePath(data.path || dirPath);
    } catch (err: any) {
      showAlert('Fout', err.message);
    } finally {
      setBrowseLoading(false);
    }
  }, [apiFetch]);

  // Load on mount — restore previous state
  useEffect(() => {
    if (mode === 'browse') {
      loadBrowse(browsePath);
    } else if (mode === 'tree' && currentDir) {
      loadDir(currentDir);
    } else if (mode === 'editor' && openFile) {
      // Reload file content for the previously open file
      (async () => {
        try {
          const data = await apiFetch(`/api/files/read?path=${encodeURIComponent(openFile.path)}`);
          if (!data.binary) {
            setFileContent(data.content);
            setOriginalContent(data.content);
          }
        } catch {
          // File may have been deleted, fall back to tree
          setMode('tree');
          _setOpenFile(null);
          setEditorOpenFile(null);
          if (currentDir) loadDir(currentDir);
        }
      })();
    }
  }, []);

  // Load file tree
  const loadDir = useCallback(async (dirPath: string) => {
    setLoading(true);
    try {
      const data = await apiFetch(`/api/files/list?path=${encodeURIComponent(dirPath)}`);
      setItems(data.items || []);
      setCurrentDir(data.path);
    } catch (err: any) {
      showAlert('Fout', err.message);
    } finally {
      setLoading(false);
    }
  }, [apiFetch, setCurrentDir]);

  const selectProject = (path: string) => {
    setProjectPath(path);
    setMode('tree');
    loadDir(path);
  };

  const openFileForEdit = async (item: FileItem) => {
    try {
      const data = await apiFetch(`/api/files/read?path=${encodeURIComponent(item.path)}`);
      if (data.binary) {
        showAlert('Binair bestand', 'Dit bestand kan niet bewerkt worden.');
        return;
      }
      setOpenFile({ path: item.path, name: data.name, language: data.language });
      setFileContent(data.content);
      setOriginalContent(data.content);
      setMode('editor');
    } catch (err: any) {
      showAlert('Fout', err.message);
    }
  };

  const handlePress = (item: FileItem) => {
    if (item.isDirectory) {
      loadDir(item.path);
    } else {
      openFileForEdit(item);
    }
  };

  const handleLongPress = (item: FileItem) => {
    showAlert(item.name, item.path, [
      {
        text: 'Verwijderen',
        style: 'destructive',
        onPress: () => {
          showAlert('Weet je het zeker?', `${item.name} verwijderen?`, [
            { text: 'Annuleer', style: 'cancel' },
            {
              text: 'Verwijder',
              style: 'destructive',
              onPress: async () => {
                try {
                  await apiFetch(`/api/files?path=${encodeURIComponent(item.path)}`, { method: 'DELETE' });
                  loadDir(currentDir);
                } catch (err: any) {
                  showAlert('Fout', err.message);
                }
              },
            },
          ]);
        },
      },
      { text: 'Annuleer', style: 'cancel' },
    ]);
  };

  const navigateUp = () => {
    const parent = currentDir.replace(/[\\/][^\\/]+$/, '');
    if (parent && parent !== currentDir) loadDir(parent);
  };

  const saveFile = async () => {
    if (!openFile) return;
    setSaving(true);
    try {
      await apiFetch('/api/files/write', {
        method: 'POST',
        body: JSON.stringify({ path: openFile.path, content: fileContent }),
      });
      setOriginalContent(fileContent);
      showAlert('Opgeslagen');
    } catch (err: any) {
      showAlert('Fout', err.message);
    } finally {
      setSaving(false);
    }
  };

  const closeEditor = () => {
    if (fileContent !== originalContent) {
      showAlert('Niet-opgeslagen wijzigingen', 'Wil je opslaan?', [
        { text: 'Verwerp', style: 'destructive', onPress: () => { setMode('tree'); setOpenFile(null); } },
        { text: 'Opslaan', onPress: async () => { await saveFile(); setMode('tree'); setOpenFile(null); } },
        { text: 'Annuleer', style: 'cancel' },
      ]);
    } else {
      setMode('tree');
      setOpenFile(null);
    }
  };

  const handleCreate = async () => {
    if (!createName.trim()) return;
    const fullPath = currentDir + '\\' + createName.trim();
    try {
      await apiFetch('/api/files/create', {
        method: 'POST',
        body: JSON.stringify({ path: fullPath, isDirectory: createType === 'folder' }),
      });
      setShowCreate(false);
      setCreateName('');
      loadDir(currentDir);
    } catch (err: any) {
      showAlert('Fout', err.message);
    }
  };

  const handleRename = async () => {
    if (!renameTarget || !renameName.trim()) return;
    const parentDir = renameTarget.path.replace(/[\\/][^\\/]+$/, '');
    const newPath = parentDir + '\\' + renameName.trim();
    try {
      await apiFetch('/api/files/rename', {
        method: 'POST',
        body: JSON.stringify({ oldPath: renameTarget.path, newPath }),
      });
      setShowRename(false);
      setRenameTarget(null);
      setRenameName('');
      loadDir(currentDir);
    } catch (err: any) {
      showAlert('Fout', err.message);
    }
  };

  const handleDeleteItem = async (item: FileItem) => {
    showAlert('Weet je het zeker?', `${item.name} verwijderen?`, [
      { text: 'Annuleer', style: 'cancel' },
      {
        text: 'Verwijder',
        style: 'destructive',
        onPress: async () => {
          try {
            await apiFetch(`/api/files?path=${encodeURIComponent(item.path)}`, { method: 'DELETE' });
            loadDir(currentDir);
          } catch (err: any) {
            showAlert('Fout', err.message);
          }
        },
      },
    ]);
  };

  const handleDownload = async (item: FileItem) => {
    if (!serverUrl || !token) return;
    setDownloadingPath(item.path);
    try {
      const result = await downloadFile(serverUrl, token, item.path, item.name);
      if (!result.ok) {
        showAlert('Fout', result.error);
      } else if (result.target === 'camera') {
        showAlert('Opgeslagen', 'Bestand opgeslagen in Camera Roll');
      }
      // share sheet: geen alert nodig, share sheet is de bevestiging
    } finally {
      setDownloadingPath(null);
    }
  };

  const browseUp = () => {
    const parent = browsePath.replace(/[\\/][^\\/]+$/, '');
    if (parent && parent !== browsePath) loadBrowse(parent);
  };

  const hasChanges = fileContent !== originalContent;

  // --- Browse view: select a project directory ---
  if (mode === 'browse') {
    return (
      <View style={styles.container}>
        {/* Header bar */}
        <View style={styles.toolbar}>
          <Text style={styles.toolbarTitle}>Kies een project</Text>
        </View>

        {/* Current path */}
        <View style={styles.pathRow}>
          {browsePath ? (
            <TouchableOpacity onPress={browseUp} style={styles.pathBtn}>
              <Ionicons name="arrow-up" size={16} color={accentColor} />
            </TouchableOpacity>
          ) : null}
          <Text style={styles.pathText} numberOfLines={1}>{browsePath || 'Server root'}</Text>
        </View>

        {browseLoading ? (
          <ActivityIndicator color={accentColor} style={{ marginTop: 40 }} />
        ) : (
          <FlatList
            data={browseDirs}
            keyExtractor={(d) => d.path}
            renderItem={({ item: d }) => (
              <View style={styles.browseItem}>
                <TouchableOpacity style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }} onPress={() => loadBrowse(d.path)}>
                  <Ionicons name="folder" size={18} color="#f59e0b" style={{ marginRight: 10 }} />
                  <Text style={styles.browseName}>{d.name}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.openBtn, { backgroundColor: accentColor }]}
                  onPress={() => selectProject(d.path)}
                >
                  <Text style={styles.openBtnText}>Open</Text>
                </TouchableOpacity>
              </View>
            )}
            ListEmptyComponent={<Text style={styles.emptyText}>Geen mappen gevonden</Text>}
          />
        )}
      </View>
    );
  }

  // --- Tree / Editor view ---
  const projectName = projectPath?.split(/[\\/]/).pop() || 'Project';

  return (
    <View style={styles.container}>
      {/* Header bar */}
      <View style={styles.toolbar}>
        {mode === 'editor' ? (
          <TouchableOpacity onPress={closeEditor} style={{ marginRight: 10 }}>
            <Ionicons name="arrow-back" size={20} color="#e0e0e0" />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={() => { setMode('browse'); setProjectPath(null); }} style={{ marginRight: 10 }}>
            <Ionicons name="arrow-back" size={20} color="#e0e0e0" />
          </TouchableOpacity>
        )}
        <Text style={styles.toolbarTitle} numberOfLines={1}>
          {mode === 'editor' ? (openFile?.name || 'Editor') : projectName}
        </Text>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          {mode === 'editor' && (
            <TouchableOpacity onPress={saveFile} disabled={saving || !hasChanges}>
              <Ionicons name="save" size={20} color={hasChanges ? '#4ade80' : '#444'} />
            </TouchableOpacity>
          )}
          {mode === 'tree' && (
            <>
              <TouchableOpacity onPress={() => { setCreateType('file'); setShowCreate(true); }}>
                <Ionicons name="add-circle-outline" size={20} color="#60a5fa" />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { setCreateType('folder'); setShowCreate(true); }}>
                <Ionicons name="folder-open-outline" size={20} color="#facc15" />
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>

      {mode === 'tree' ? (
        <FileTree
          items={items}
          loading={loading}
          onPress={handlePress}
          onLongPress={handleLongPress}
          onMenuPress={(item) => setContextItem(item)}
          currentPath={currentDir !== projectPath ? currentDir : undefined}
          onNavigateUp={currentDir !== projectPath ? navigateUp : undefined}
        />
      ) : (
        <>
          {openFile && (
            <View style={styles.editorHeader}>
              <View style={[styles.dot, { backgroundColor: hasChanges ? '#facc15' : '#4ade80' }]} />
              <Text style={styles.fileName}>{openFile.name}</Text>
              <Text style={styles.fileLang}>{openFile.language}</Text>
            </View>
          )}
          {/* Editor shortcut toolbar — above editor */}
          <View style={styles.editorToolbar}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.editorToolbarContent}
              keyboardShouldPersistTaps="always"
            >
              <TouchableOpacity style={[styles.eToolBtn, styles.eToolEnter]} onPress={() => editorRef.current?.execCommand('newline')} activeOpacity={0.6}>
                <Ionicons name="return-down-back" size={14} color={accentColor} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.eToolBtn} onPress={() => editorRef.current?.insertText('  ')} activeOpacity={0.6}>
                <Text style={styles.eToolBtnText}>TAB</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.eToolBtn} onPress={() => editorRef.current?.execCommand('undo')} activeOpacity={0.6}>
                <Text style={styles.eToolBtnText}>Undo</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.eToolBtn} onPress={() => editorRef.current?.execCommand('redo')} activeOpacity={0.6}>
                <Text style={styles.eToolBtnText}>Redo</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.eToolBtn} onPress={() => editorRef.current?.execCommand('selectAll')} activeOpacity={0.6}>
                <Text style={styles.eToolBtnText}>Ctrl+A</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.eToolBtn} onPress={() => editorRef.current?.execCommand('copy')} activeOpacity={0.6}>
                <Text style={styles.eToolBtnText}>Ctrl+C</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.eToolBtn} onPress={() => editorRef.current?.execCommand('paste')} activeOpacity={0.6}>
                <Text style={styles.eToolBtnText}>Ctrl+V</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.eToolBtn} onPress={() => editorRef.current?.execCommand('cut')} activeOpacity={0.6}>
                <Text style={styles.eToolBtnText}>Ctrl+X</Text>
              </TouchableOpacity>
            </ScrollView>
            <TouchableOpacity
              style={styles.eToolDismiss}
              onPress={() => Keyboard.dismiss()}
              activeOpacity={0.6}
            >
              <Ionicons name="chevron-down-outline" size={16} color="#888" />
            </TouchableOpacity>
          </View>
          <CodeEditor
            ref={editorRef}
            content={fileContent}
            language={openFile?.language || 'plaintext'}
            onChange={setFileContent}
          />
        </>
      )}

      {/* Floating terminal panel */}
      {projectPath && (
        <EditorTerminal
          projectPath={projectPath}
          visible={showTerminal}
          onClose={() => setShowTerminal(false)}
        />
      )}

      {/* Terminal FAB */}
      {!showTerminal && projectPath && (
        <TouchableOpacity
          style={[styles.terminalFab, { backgroundColor: accentColor }]}
          onPress={() => setShowTerminal(true)}
          activeOpacity={0.8}
        >
          <Ionicons name="terminal" size={24} color="#0a0a0a" />
        </TouchableOpacity>
      )}

      {/* Context menu (3 dots) */}
      <Modal visible={!!contextItem} transparent animationType="fade" onRequestClose={() => setContextItem(null)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setContextItem(null)}>
          <View style={styles.dialog} onStartShouldSetResponder={() => true}>
            <Text style={styles.dialogTitle} numberOfLines={1}>{contextItem?.name}</Text>
            {!contextItem?.isDirectory && (
              <TouchableOpacity
                style={styles.contextOption}
                onPress={() => {
                  const item = contextItem!;
                  setContextItem(null);
                  handleDownload(item);
                }}
              >
                {downloadingPath === contextItem?.path ? (
                  <ActivityIndicator size="small" color="#4ade80" style={{ marginRight: 12, width: 18 }} />
                ) : (
                  <Ionicons name="download" size={18} color="#4ade80" style={{ marginRight: 12 }} />
                )}
                <Text style={styles.contextOptionText}>Downloaden</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.contextOption}
              onPress={() => {
                const item = contextItem!;
                setContextItem(null);
                setRenameTarget(item);
                setRenameName(item.name);
                setShowRename(true);
              }}
            >
              <Ionicons name="pencil" size={18} color="#60a5fa" style={{ marginRight: 12 }} />
              <Text style={styles.contextOptionText}>Hernoemen</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.contextOption}
              onPress={() => {
                const item = contextItem!;
                setContextItem(null);
                handleDeleteItem(item);
              }}
            >
              <Ionicons name="trash" size={18} color="#f87171" style={{ marginRight: 12 }} />
              <Text style={[styles.contextOptionText, { color: '#f87171' }]}>Verwijderen</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Rename dialog */}
      <Modal visible={showRename} transparent animationType="fade" onRequestClose={() => setShowRename(false)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setShowRename(false)}>
          <View style={styles.dialog} onStartShouldSetResponder={() => true}>
            <Text style={styles.dialogTitle}>Hernoemen</Text>
            <TextInput
              style={styles.dialogInput}
              placeholder="Nieuwe naam"
              placeholderTextColor="#555"
              value={renameName}
              onChangeText={setRenameName}
              autoFocus
              autoCapitalize="none"
              returnKeyType="done"
              onSubmitEditing={handleRename}
            />
            <View style={styles.dialogButtons}>
              <TouchableOpacity style={styles.dialogCancel} onPress={() => { setShowRename(false); setRenameTarget(null); setRenameName(''); }}>
                <Text style={styles.dialogCancelText}>Annuleer</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.dialogConfirm, { backgroundColor: accentColor }]} onPress={handleRename}>
                <Text style={styles.dialogConfirmText}>Hernoemen</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Create dialog */}
      <Modal visible={showCreate} transparent animationType="fade" onRequestClose={() => setShowCreate(false)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setShowCreate(false)}>
          <View style={styles.dialog} onStartShouldSetResponder={() => true}>
            <Text style={styles.dialogTitle}>
              {createType === 'file' ? 'Nieuw bestand' : 'Nieuwe map'}
            </Text>
            <TextInput
              style={styles.dialogInput}
              placeholder={createType === 'file' ? 'bestandsnaam.txt' : 'mapnaam'}
              placeholderTextColor="#555"
              value={createName}
              onChangeText={setCreateName}
              autoFocus
              autoCapitalize="none"
              returnKeyType="done"
              onSubmitEditing={handleCreate}
            />
            <View style={styles.dialogButtons}>
              <TouchableOpacity style={styles.dialogCancel} onPress={() => { setShowCreate(false); setCreateName(''); }}>
                <Text style={styles.dialogCancelText}>Annuleer</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.dialogConfirm, { backgroundColor: accentColor }]} onPress={handleCreate}>
                <Text style={styles.dialogConfirmText}>Aanmaken</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const c = require('../../constants/theme').colors;
const sp = require('../../constants/theme').spacing;
const r = require('../../constants/theme').radius;
const fs = require('../../constants/theme').fontSize;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: sp.lg,
    paddingVertical: sp.md,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  toolbarTitle: {
    color: c.text,
    fontSize: fs.body,
    fontWeight: '700',
    flex: 1,
  },
  pathRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: sp.lg,
    paddingVertical: sp.sm,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  pathBtn: { marginRight: sp.sm },
  pathText: { color: c.textMuted, fontSize: fs.caption, flex: 1 },
  browseItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: sp.lg,
    paddingVertical: sp.md,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  browseName: { color: c.text, fontSize: fs.standard, flex: 1 },
  openBtn: {
    paddingHorizontal: sp.md,
    paddingVertical: 6,
    borderRadius: r.sm,
  },
  openBtnText: { color: c.bg, fontSize: fs.caption, fontWeight: '700' },
  emptyText: { color: c.textDim, fontSize: fs.standard, textAlign: 'center', paddingTop: 40 },
  editorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: sp.sm,
    backgroundColor: c.surface,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: sp.sm },
  fileName: { color: c.text, fontSize: fs.standard, fontWeight: '600', flex: 1 },
  fileLang: { color: c.textDim, fontSize: fs.micro },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dialog: {
    backgroundColor: c.elevated,
    borderRadius: r.lg,
    padding: sp.xl,
    width: '85%',
  },
  dialogTitle: { color: c.text, fontSize: fs.header, fontWeight: '700', marginBottom: 14 },
  dialogInput: {
    backgroundColor: c.bg,
    color: c.text,
    borderRadius: r.md,
    padding: 14,
    fontSize: fs.body,
    borderWidth: 1,
    borderColor: c.borderStrong,
    marginBottom: 14,
  },
  dialogButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  dialogCancel: { padding: sp.md },
  dialogCancelText: { color: c.textMuted, fontSize: fs.standard },
  dialogConfirm: { borderRadius: r.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md },
  dialogConfirmText: { color: c.bg, fontWeight: '700', fontSize: fs.standard },
  terminalFab: {
    position: 'absolute',
    bottom: 24,
    right: sp.xl,
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
  editorToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.surface,
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
  editorToolbarContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: sp.xs,
    paddingVertical: sp.xs,
    gap: sp.xs,
  },
  eToolBtn: {
    paddingHorizontal: sp.md,
    paddingVertical: 6,
    backgroundColor: c.elevated,
    borderRadius: r.sm,
    borderWidth: 1,
    borderColor: c.borderStrong,
  },
  eToolEnter: {
    borderColor: '#4ade8040',
    backgroundColor: '#4ade8010',
  },
  eToolBtnText: {
    color: c.textSecondary,
    fontSize: fs.micro,
    fontWeight: '600',
  },
  eToolDismiss: {
    paddingHorizontal: sp.sm,
    paddingVertical: 6,
  },
  contextOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: sp.md,
    paddingHorizontal: sp.xs,
  },
  contextOptionText: {
    color: c.text,
    fontSize: fs.body,
  },
  contextDivider: {
    height: 1,
    backgroundColor: c.borderStrong,
    marginVertical: sp.xs,
  },
});
