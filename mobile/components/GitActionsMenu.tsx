import React, { useState } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, TextInput,
  FlatList, Alert, ScrollView, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, fontSize as fs } from '../constants/theme';

interface StashItem {
  index: number;
  message: string;
}

interface TagItem {
  name: string;
  hash: string;
  date: string;
  message: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  // Stash
  stashes: StashItem[];
  onStash: (message?: string) => void;
  onStashPop: (index?: number) => void;
  onStashDrop: (index: number) => void;
  // Merge
  branches: string[];
  currentBranch: string;
  onMerge: (branch: string) => void;
  // Tags
  tags: TagItem[];
  onCreateTag: (name: string, message?: string) => void;
  onDeleteTag: (name: string) => void;
  // Loading
  loading?: boolean;
}

export default function GitActionsMenu({
  visible,
  onClose,
  stashes,
  onStash,
  onStashPop,
  onStashDrop,
  branches,
  currentBranch,
  onMerge,
  tags,
  onCreateTag,
  onDeleteTag,
  loading,
}: Props) {
  const [showStash, setShowStash] = useState(true);
  const [showMerge, setShowMerge] = useState(false);
  const [showTags, setShowTags] = useState(false);

  const [stashMessage, setStashMessage] = useState('');
  const [tagName, setTagName] = useState('');
  const [tagMessage, setTagMessage] = useState('');

  const handleStash = () => {
    onStash(stashMessage.trim() || undefined);
    setStashMessage('');
  };

  const handleStashDrop = (index: number) => {
    Alert.alert('Stash verwijderen', 'Weet je het zeker?', [
      { text: 'Annuleren', style: 'cancel' },
      { text: 'Verwijderen', style: 'destructive', onPress: () => onStashDrop(index) },
    ]);
  };

  const handleMerge = (branch: string) => {
    Alert.alert(
      'Merge bevestigen',
      `Branch ${branch} mergen naar ${currentBranch}?`,
      [
        { text: 'Annuleren', style: 'cancel' },
        { text: 'Merge', onPress: () => onMerge(branch) },
      ],
    );
  };

  const handleCreateTag = () => {
    const name = tagName.trim();
    if (!name) return;
    onCreateTag(name, tagMessage.trim() || undefined);
    setTagName('');
    setTagMessage('');
  };

  const handleDeleteTag = (name: string) => {
    Alert.alert('Tag verwijderen', `Weet je het zeker dat je tag "${name}" wilt verwijderen?`, [
      { text: 'Annuleren', style: 'cancel' },
      { text: 'Verwijderen', style: 'destructive', onPress: () => onDeleteTag(name) },
    ]);
  };

  const otherBranches = branches.filter((b) => b !== currentBranch);

  const renderSectionHeader = (
    title: string,
    icon: keyof typeof Ionicons.glyphMap,
    expanded: boolean,
    toggle: () => void,
  ) => (
    <TouchableOpacity style={s.sectionHeader} onPress={toggle} activeOpacity={0.7}>
      <View style={s.sectionHeaderLeft}>
        <Ionicons name={icon} size={18} color={colors.accent} />
        <Text style={s.sectionTitle}>{title}</Text>
      </View>
      <Ionicons
        name={expanded ? 'chevron-up' : 'chevron-down'}
        size={18}
        color={colors.textMuted}
      />
    </TouchableOpacity>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <TouchableOpacity style={s.backdropTouch} activeOpacity={1} onPress={onClose} />
        <View style={s.panel}>
          {/* Header */}
          <View style={s.header}>
            <Text style={s.headerTitle}>Git Acties</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {loading && (
            <ActivityIndicator
              size="small"
              color={colors.accent}
              style={{ marginBottom: spacing.md }}
            />
          )}

          <ScrollView style={s.scrollContent} showsVerticalScrollIndicator={false}>
            {/* ── Stash Section ── */}
            {renderSectionHeader('Stash', 'layers-outline', showStash, () =>
              setShowStash((p) => !p),
            )}
            {showStash && (
              <View style={s.sectionBody}>
                <View style={s.inputRow}>
                  <TextInput
                    style={s.input}
                    placeholder="Stash bericht (optioneel)"
                    placeholderTextColor={colors.textMuted}
                    value={stashMessage}
                    onChangeText={setStashMessage}
                  />
                  <TouchableOpacity style={s.actionBtn} onPress={handleStash}>
                    <Text style={s.actionBtnText}>Stash wijzigingen</Text>
                  </TouchableOpacity>
                </View>

                {stashes.length === 0 && (
                  <Text style={s.emptyText}>Geen stashes gevonden</Text>
                )}

                {stashes.map((item) => (
                  <View key={item.index} style={s.listRow}>
                    <Text style={s.stashLabel} numberOfLines={1}>
                      stash@{'{' + item.index + '}'}: {item.message}
                    </Text>
                    <View style={s.rowActions}>
                      <TouchableOpacity
                        style={[s.smallBtn, s.popBtn]}
                        onPress={() => onStashPop(item.index)}
                      >
                        <Text style={s.smallBtnText}>Pop</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[s.smallBtn, s.dropBtn]}
                        onPress={() => handleStashDrop(item.index)}
                      >
                        <Text style={s.smallBtnTextRed}>Drop</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* ── Merge Section ── */}
            {renderSectionHeader('Merge', 'git-merge-outline', showMerge, () =>
              setShowMerge((p) => !p),
            )}
            {showMerge && (
              <View style={s.sectionBody}>
                {otherBranches.length === 0 && (
                  <Text style={s.emptyText}>Geen andere branches gevonden</Text>
                )}

                {otherBranches.map((branch) => (
                  <TouchableOpacity
                    key={branch}
                    style={s.branchRow}
                    onPress={() => handleMerge(branch)}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="git-branch-outline" size={16} color={colors.textSecondary} />
                    <Text style={s.branchName}>{branch}</Text>
                    <Ionicons name="arrow-forward" size={14} color={colors.textMuted} />
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* ── Tags Section ── */}
            {renderSectionHeader('Tags', 'pricetag-outline', showTags, () =>
              setShowTags((p) => !p),
            )}
            {showTags && (
              <View style={s.sectionBody}>
                <View style={s.tagCreateBlock}>
                  <TextInput
                    style={s.input}
                    placeholder="Tag naam"
                    placeholderTextColor={colors.textMuted}
                    value={tagName}
                    onChangeText={setTagName}
                  />
                  <TextInput
                    style={[s.input, { marginTop: spacing.sm }]}
                    placeholder="Bericht (optioneel)"
                    placeholderTextColor={colors.textMuted}
                    value={tagMessage}
                    onChangeText={setTagMessage}
                  />
                  <TouchableOpacity
                    style={[s.actionBtn, { marginTop: spacing.sm }]}
                    onPress={handleCreateTag}
                  >
                    <Text style={s.actionBtnText}>Aanmaken</Text>
                  </TouchableOpacity>
                </View>

                {tags.length === 0 && (
                  <Text style={s.emptyText}>Geen tags gevonden</Text>
                )}

                {tags.map((tag) => (
                  <View key={tag.name} style={s.tagRow}>
                    <View style={s.tagInfo}>
                      <Text style={s.tagName}>{tag.name}</Text>
                      <Text style={s.tagMeta}>
                        {tag.hash?.slice(0, 7)} {tag.date ? `· ${tag.date}` : ''}
                      </Text>
                      {tag.message ? (
                        <Text style={s.tagMessage} numberOfLines={2}>
                          {tag.message}
                        </Text>
                      ) : null}
                    </View>
                    <TouchableOpacity
                      onPress={() => handleDeleteTag(tag.name)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name="trash-outline" size={18} color={colors.red} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            {/* Bottom spacer */}
            <View style={{ height: spacing.xl }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  backdropTouch: {
    flex: 1,
  },
  panel: {
    height: '75%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  headerTitle: {
    color: colors.text,
    fontSize: fs.title,
    fontWeight: '700',
  },
  scrollContent: {
    flex: 1,
  },

  // Section header
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderStrong,
  },
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: fs.header,
    fontWeight: '600',
  },

  // Section body
  sectionBody: {
    paddingVertical: spacing.md,
  },

  // Inputs
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  input: {
    flex: 1,
    backgroundColor: colors.elevated,
    color: colors.text,
    fontSize: fs.standard,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },

  // Action button
  actionBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  actionBtnText: {
    color: colors.bg,
    fontSize: fs.standard,
    fontWeight: '600',
  },

  // Empty state
  emptyText: {
    color: colors.textMuted,
    fontSize: fs.standard,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: spacing.md,
  },

  // Stash list
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.elevated,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  stashLabel: {
    flex: 1,
    color: colors.text,
    fontSize: fs.caption,
    fontFamily: 'monospace',
    marginRight: spacing.sm,
  },
  rowActions: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  smallBtn: {
    borderRadius: radius.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  popBtn: {
    backgroundColor: 'rgba(74,222,128,0.15)',
  },
  dropBtn: {
    backgroundColor: 'rgba(248,113,113,0.15)',
  },
  smallBtnText: {
    color: colors.accent,
    fontSize: fs.caption,
    fontWeight: '600',
  },
  smallBtnTextRed: {
    color: colors.red,
    fontSize: fs.caption,
    fontWeight: '600',
  },

  // Branch list
  branchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.elevated,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  branchName: {
    flex: 1,
    color: colors.text,
    fontSize: fs.standard,
  },

  // Tag create
  tagCreateBlock: {
    marginBottom: spacing.md,
  },

  // Tag list
  tagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.elevated,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  tagInfo: {
    flex: 1,
    marginRight: spacing.sm,
  },
  tagName: {
    color: colors.accent,
    fontSize: fs.body,
    fontWeight: '600',
  },
  tagMeta: {
    color: colors.textMuted,
    fontSize: fs.caption,
    fontFamily: 'monospace',
    marginTop: 2,
  },
  tagMessage: {
    color: colors.textSecondary,
    fontSize: fs.caption,
    marginTop: spacing.xs,
  },
});
