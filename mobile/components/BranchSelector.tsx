import React, { useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, TextInput,
  FlatList, ActivityIndicator, Alert, Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, fontSize as fs } from '../constants/theme';

interface Props {
  visible: boolean;
  onClose: () => void;
  branches: string[];
  currentBranch: string;
  onCheckout: (branch: string) => void;
  onCreate: (name: string, base?: string) => void;
  onDelete: (name: string) => void;
  loading?: boolean;
}

const SCREEN_HEIGHT = Dimensions.get('window').height;

export default function BranchSelector({
  visible, onClose, branches, currentBranch,
  onCheckout, onCreate, onDelete, loading,
}: Props) {
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [baseBranch, setBaseBranch] = useState('');
  const [showBasePicker, setShowBasePicker] = useState(false);

  const { local, remote } = useMemo(() => {
    const l: string[] = [];
    const r: string[] = [];
    for (const b of branches) {
      if (b.startsWith('remotes/origin/') || b.startsWith('origin/')) {
        r.push(b);
      } else {
        l.push(b);
      }
    }
    return { local: l, remote: r };
  }, [branches]);

  const filter = (list: string[]) => {
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter(b => b.toLowerCase().includes(q));
  };

  const filteredLocal = filter(local);
  const filteredRemote = filter(remote);

  type ListItem =
    | { type: 'header'; title: string }
    | { type: 'branch'; name: string; isRemote: boolean };

  const data: ListItem[] = useMemo(() => {
    const items: ListItem[] = [];
    if (filteredLocal.length > 0) {
      items.push({ type: 'header', title: 'Lokaal' });
      for (const b of filteredLocal) {
        items.push({ type: 'branch', name: b, isRemote: false });
      }
    }
    if (filteredRemote.length > 0) {
      items.push({ type: 'header', title: 'Remote' });
      for (const b of filteredRemote) {
        items.push({ type: 'branch', name: b, isRemote: true });
      }
    }
    return items;
  }, [filteredLocal, filteredRemote]);

  const handleCheckout = (branch: string) => {
    if (branch === currentBranch) return;
    Alert.alert(
      'Branch wisselen',
      `Wil je overschakelen naar "${branch}"?`,
      [
        { text: 'Annuleren', style: 'cancel' },
        { text: 'Wisselen', onPress: () => onCheckout(branch) },
      ],
    );
  };

  const handleLongPress = (branch: string) => {
    if (branch === currentBranch) return;
    Alert.alert(
      'Branch verwijderen',
      `Weet je zeker dat je "${branch}" wilt verwijderen?`,
      [
        { text: 'Annuleren', style: 'cancel' },
        { text: 'Verwijderen', style: 'destructive', onPress: () => onDelete(branch) },
      ],
    );
  };

  const handleCreate = () => {
    const name = newName.trim();
    if (!name) return;
    onCreate(name, baseBranch.trim() || undefined);
    setNewName('');
    setBaseBranch('');
    setShowCreate(false);
    setShowBasePicker(false);
  };

  const handleClose = () => {
    setSearch('');
    setShowCreate(false);
    setNewName('');
    setBaseBranch('');
    setShowBasePicker(false);
    onClose();
  };

  const selectBase = (branch: string) => {
    setBaseBranch(branch);
    setShowBasePicker(false);
  };

  const renderItem = ({ item }: { item: ListItem }) => {
    if (item.type === 'header') {
      return (
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{item.title}</Text>
        </View>
      );
    }

    const isCurrent = item.name === currentBranch;
    const displayName = item.isRemote
      ? item.name.replace(/^(remotes\/origin\/|origin\/)/, '')
      : item.name;

    return (
      <TouchableOpacity
        style={[styles.branchRow, isCurrent && styles.branchRowCurrent]}
        onPress={() => handleCheckout(item.name)}
        onLongPress={() => !item.isRemote ? handleLongPress(item.name) : undefined}
        activeOpacity={0.7}
      >
        <View style={styles.branchInfo}>
          <Ionicons
            name={item.isRemote ? 'cloud-outline' : 'git-branch-outline'}
            size={16}
            color={isCurrent ? colors.accent : colors.textSecondary}
            style={styles.branchIcon}
          />
          <Text
            style={[styles.branchName, isCurrent && styles.branchNameCurrent]}
            numberOfLines={1}
          >
            {displayName}
          </Text>
        </View>
        {isCurrent && (
          <Ionicons name="checkmark" size={18} color={colors.accent} />
        )}
      </TouchableOpacity>
    );
  };

  const keyExtractor = (item: ListItem, index: number) =>
    item.type === 'header' ? `header-${item.title}` : `branch-${item.name}-${index}`;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.backdropTouch} onPress={handleClose} activeOpacity={1} />
        <View style={styles.panel}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>Branches</Text>
            <TouchableOpacity onPress={handleClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Search */}
          <View style={styles.searchRow}>
            <Ionicons name="search" size={16} color={colors.textMuted} style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder="Zoek branch..."
              placeholderTextColor={colors.textMuted}
              value={search}
              onChangeText={setSearch}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {search.length > 0 && (
              <TouchableOpacity onPress={() => setSearch('')}>
                <Ionicons name="close-circle" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>

          {/* New branch button / form */}
          {!showCreate ? (
            <TouchableOpacity
              style={styles.createBtn}
              onPress={() => setShowCreate(true)}
            >
              <Ionicons name="add-circle-outline" size={18} color={colors.accent} />
              <Text style={styles.createBtnText}>Nieuwe branch</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.createForm}>
              <TextInput
                style={styles.createInput}
                placeholder="Branch naam"
                placeholderTextColor={colors.textMuted}
                value={newName}
                onChangeText={setNewName}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity
                style={styles.baseBtn}
                onPress={() => setShowBasePicker(!showBasePicker)}
              >
                <Text style={styles.baseBtnText} numberOfLines={1}>
                  {baseBranch || 'Basis: huidige branch'}
                </Text>
                <Ionicons
                  name={showBasePicker ? 'chevron-up' : 'chevron-down'}
                  size={14}
                  color={colors.textSecondary}
                />
              </TouchableOpacity>
              {showBasePicker && (
                <View style={styles.basePicker}>
                  {local.map(b => (
                    <TouchableOpacity
                      key={b}
                      style={styles.baseOption}
                      onPress={() => selectBase(b)}
                    >
                      <Text style={[
                        styles.baseOptionText,
                        b === baseBranch && { color: colors.accent },
                      ]}>
                        {b}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              <View style={styles.createActions}>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => {
                    setShowCreate(false);
                    setNewName('');
                    setBaseBranch('');
                    setShowBasePicker(false);
                  }}
                >
                  <Text style={styles.cancelBtnText}>Annuleren</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.submitBtn, !newName.trim() && styles.submitBtnDisabled]}
                  onPress={handleCreate}
                  disabled={!newName.trim()}
                >
                  <Text style={styles.submitBtnText}>Aanmaken</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Loading */}
          {loading && (
            <ActivityIndicator
              size="small"
              color={colors.accent}
              style={styles.loader}
            />
          )}

          {/* Branch list */}
          <FlatList
            data={data}
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            style={styles.list}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <View style={styles.empty}>
                <Ionicons name="git-branch-outline" size={32} color={colors.textMuted} />
                <Text style={styles.emptyText}>
                  {search.trim()
                    ? 'Geen branches gevonden'
                    : 'Geen branches beschikbaar'}
                </Text>
              </View>
            }
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  backdropTouch: {
    flex: 1,
  },
  panel: {
    height: SCREEN_HEIGHT * 0.7,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingTop: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: {
    fontSize: fs.header,
    fontWeight: '700',
    color: colors.text,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.elevated,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    height: 40,
  },
  searchIcon: {
    marginRight: spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: fs.standard,
    color: colors.text,
    padding: 0,
  },
  createBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  createBtnText: {
    fontSize: fs.standard,
    color: colors.accent,
    fontWeight: '600',
  },
  createForm: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    backgroundColor: colors.elevated,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  createInput: {
    backgroundColor: colors.bg,
    borderRadius: radius.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: fs.standard,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  baseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.bg,
    borderRadius: radius.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  baseBtnText: {
    fontSize: fs.caption,
    color: colors.textSecondary,
    flex: 1,
  },
  basePicker: {
    backgroundColor: colors.bg,
    borderRadius: radius.xs,
    marginBottom: spacing.sm,
    maxHeight: 120,
  },
  baseOption: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
  },
  baseOptionText: {
    fontSize: fs.caption,
    color: colors.textSecondary,
  },
  createActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  cancelBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.xs,
  },
  cancelBtnText: {
    fontSize: fs.standard,
    color: colors.textSecondary,
  },
  submitBtn: {
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.xs,
  },
  submitBtnDisabled: {
    opacity: 0.4,
  },
  submitBtnText: {
    fontSize: fs.standard,
    color: colors.bg,
    fontWeight: '600',
  },
  loader: {
    marginTop: spacing.md,
  },
  list: {
    flex: 1,
    marginTop: spacing.sm,
  },
  listContent: {
    paddingBottom: spacing.xl,
  },
  sectionHeader: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  sectionTitle: {
    fontSize: fs.caption,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  branchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderLeftWidth: 3,
    borderLeftColor: 'transparent',
  },
  branchRowCurrent: {
    borderLeftColor: colors.accent,
    backgroundColor: 'rgba(74, 222, 128, 0.06)',
  },
  branchInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: spacing.sm,
  },
  branchIcon: {
    marginRight: spacing.sm,
  },
  branchName: {
    fontSize: fs.standard,
    color: colors.text,
    flex: 1,
  },
  branchNameCurrent: {
    color: colors.accent,
    fontWeight: '600',
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl * 2,
    gap: spacing.md,
  },
  emptyText: {
    fontSize: fs.standard,
    color: colors.textMuted,
  },
});
