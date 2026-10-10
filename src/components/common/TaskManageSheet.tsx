/**
 * Task Manage Sheet
 *
 * Opened from the "Manage" button on a Tasks tab row. Same look as the
 * Tools & Connections manage sheet:
 * - Overview: status, recurrence, next / last run, plus Run now, Edit schedule
 *   and Delete task (with an inline confirmation)
 * - Edit: rename and change daily / weekly, weekday and time
 *
 * The sheet only collects input. Saving, deleting and running are done by the
 * Tasks screen through `src/services/scheduledTasks.ts`.
 */
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { HugeiconsIcon } from '@hugeicons/react-native';
import {
  ArrowLeft01Icon,
  Cancel01Icon,
  Delete02Icon,
  Edit02Icon,
  PlayIcon,
  Target01Icon,
} from '@hugeicons/core-free-icons';

import { Colors } from '@/constants/colors';
import {
  describeSchedule,
  normalizeTime,
  parseTime,
  type ScheduleFrequency,
  type ScheduleRule,
  type Weekday,
} from '@/lib/scheduleRules';
import {
  describeDelivery,
  describeLastRun,
  describeTaskNextRun,
  describeTaskSchedule,
  type ScheduledTask,
  type ScheduledTaskEdit,
} from '@/services/scheduledTasks';

/** Monday first, the way people read a week. */
const WEEK_ORDER: { key: Weekday; label: string }[] = [
  { key: 'monday', label: 'Mon' },
  { key: 'tuesday', label: 'Tue' },
  { key: 'wednesday', label: 'Wed' },
  { key: 'thursday', label: 'Thu' },
  { key: 'friday', label: 'Fri' },
  { key: 'saturday', label: 'Sat' },
  { key: 'sunday', label: 'Sun' },
];

interface Draft {
  title: string;
  frequency: ScheduleFrequency;
  weekday: Weekday;
  /** 1-12 */
  hour12: number;
  /** 0-59 */
  minute: number;
  pm: boolean;
}

function draftFromTask(task: ScheduledTask): Draft {
  const rule = task.scheduleRule;
  const time = parseTime(rule?.time ?? '') ?? { hour: 8, minute: 0 };
  return {
    title: task.title,
    frequency: rule?.frequency === 'weekly' ? 'weekly' : 'daily',
    weekday: (rule?.weekday as Weekday) ?? 'monday',
    hour12: time.hour % 12 === 0 ? 12 : time.hour % 12,
    minute: time.minute,
    pm: time.hour >= 12,
  };
}

function ruleFromDraft(draft: Draft): ScheduleRule {
  const hour24 = (draft.hour12 % 12) + (draft.pm ? 12 : 0);
  const time =
    normalizeTime(`${hour24}:${String(draft.minute).padStart(2, '0')}`) ?? '08:00';
  return {
    frequency: draft.frequency,
    time,
    ...(draft.frequency === 'weekly' ? { weekday: draft.weekday } : {}),
  };
}

export interface TaskManageSheetProps {
  task: ScheduledTask | null;
  /** A run is in flight for this task. */
  running: boolean;
  onClose: () => void;
  onRun: (task: ScheduledTask) => void;
  onSave: (task: ScheduledTask, edit: ScheduledTaskEdit) => Promise<void>;
  onDelete: (task: ScheduledTask) => Promise<void>;
}

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.chip, selected && styles.chipSelected]}
      activeOpacity={0.8}
      onPress={onPress}>
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </TouchableOpacity>
  );
}

function Stepper({
  label,
  value,
  onDecrease,
  onIncrease,
}: {
  label: string;
  value: string;
  onDecrease: () => void;
  onIncrease: () => void;
}) {
  return (
    <View style={styles.stepper}>
      <Text style={[styles.fieldLabel, styles.stepperLabel]}>{label}</Text>
      <View style={styles.stepperRow}>
        <TouchableOpacity
          style={styles.stepBtn}
          onPress={onDecrease}
          hitSlop={6}
          activeOpacity={0.7}>
          <Text style={styles.stepBtnText}>−</Text>
        </TouchableOpacity>
        <Text style={styles.stepValue}>{value}</Text>
        <TouchableOpacity
          style={styles.stepBtn}
          onPress={onIncrease}
          hitSlop={6}
          activeOpacity={0.7}>
          <Text style={styles.stepBtnText}>+</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export function TaskManageSheet({
  task,
  running,
  onClose,
  onRun,
  onSave,
  onDelete,
}: TaskManageSheetProps) {
  const [mode, setMode] = useState<'overview' | 'edit'>('overview');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Every time a different task opens (or the sheet closes) start clean.
  const taskId = task?.id ?? null;
  useEffect(() => {
    setMode('overview');
    setDraft(null);
    setConfirmingDelete(false);
    setSaving(false);
    setDeleting(false);
  }, [taskId]);

  const isActive = task?.status === 'active';
  const lastRun = task ? describeLastRun(task) : null;
  const lastFailed = task?.lastRunStatus === 'failed';
  const working = saving || deleting;

  const startEdit = () => {
    if (!task) return;
    setDraft(draftFromTask(task));
    setMode('edit');
  };

  const patchDraft = (patch: Partial<Draft>) =>
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));

  const save = async () => {
    if (!task || !draft || working) return;
    setSaving(true);
    try {
      await onSave(task, { title: draft.title, scheduleRule: ruleFromDraft(draft) });
      setMode('overview');
    } catch {
      // The screen shows the error toast; stay in the editor so nothing is lost.
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!task || working) return;
    setDeleting(true);
    try {
      await onDelete(task);
    } catch {
      setDeleting(false);
    }
  };

  const draftSummary = draft ? describeSchedule(ruleFromDraft(draft)) : '';

  return (
    <Modal visible={!!task} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={styles.backdrop} onPress={working ? undefined : onClose}>
          {task && (
            <Pressable style={styles.sheet} onPress={() => {}}>
              <ScrollView
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled">
                {mode === 'overview' || !draft ? (
                  <>
                    <View style={styles.sheetHeader}>
                      <View style={styles.iconTile}>
                        <HugeiconsIcon
                          icon={Target01Icon}
                          size={22}
                          color={isActive ? Colors.primary : Colors.iconMuted}
                          strokeWidth={2}
                        />
                      </View>
                      <View style={styles.sheetTitleWrap}>
                        <Text style={styles.sheetTitle} numberOfLines={2}>
                          {task.title}
                        </Text>
                        <View
                          style={[
                            styles.statusChip,
                            {
                              backgroundColor:
                                (isActive ? Colors.success : Colors.iconMuted) + '1F',
                            },
                          ]}>
                          <View
                            style={[
                              styles.statusDot,
                              {
                                backgroundColor: isActive ? Colors.success : Colors.iconMuted,
                              },
                            ]}
                          />
                          <Text
                            style={[
                              styles.statusChipText,
                              { color: isActive ? Colors.success : Colors.iconMuted },
                            ]}>
                            {isActive ? 'Active' : 'Paused'}
                          </Text>
                        </View>
                      </View>
                      <TouchableOpacity
                        style={styles.closeBtn}
                        onPress={onClose}
                        disabled={working}
                        activeOpacity={0.6}>
                        <HugeiconsIcon
                          icon={Cancel01Icon}
                          size={18}
                          color={Colors.iconMuted}
                          strokeWidth={2}
                        />
                      </TouchableOpacity>
                    </View>

                    <View style={styles.infoCard}>
                      <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>REPEATS</Text>
                        <Text style={styles.infoValue}>
                          {describeTaskSchedule(task)}
                        </Text>
                        <Text style={styles.infoSub}>{task.timezone}</Text>
                      </View>
                      <View style={styles.infoDivider} />
                      <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>NEXT RUN</Text>
                        <Text style={[styles.infoValue, !isActive && styles.infoValueMuted]}>
                          {isActive ? describeTaskNextRun(task) : 'Paused'}
                        </Text>
                      </View>
                      <View style={styles.infoDivider} />
                      <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>DELIVERY</Text>
                        <Text style={styles.infoValue}>{describeDelivery(task.delivery)}</Text>
                      </View>
                      <View style={styles.infoDivider} />
                      <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>LAST RUN</Text>
                        {lastRun ? (
                          <Text
                            style={[styles.infoValue, lastFailed && styles.infoValueError]}
                            numberOfLines={3}>
                            {lastFailed
                              ? `Failed · ${lastRun}\n${task.lastRunError ?? 'Unknown error'}`
                              : `Completed · ${lastRun}`}
                          </Text>
                        ) : (
                          <Text style={[styles.infoValue, styles.infoValueMuted]}>
                            Not run yet
                          </Text>
                        )}
                      </View>
                    </View>

                    {confirmingDelete ? (
                      <View style={styles.confirmBox}>
                        <Text style={styles.confirmTitle}>Delete this task?</Text>
                        <Text style={styles.confirmText}>
                          It stops running and can't be restored. Results already
                          delivered to your chat stay there.
                        </Text>
                        <View style={styles.confirmActions}>
                          <TouchableOpacity
                            style={[styles.confirmBtn, styles.confirmCancel]}
                            activeOpacity={0.8}
                            disabled={deleting}
                            onPress={() => setConfirmingDelete(false)}>
                            <Text style={styles.confirmCancelText}>Keep it</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.confirmBtn, styles.confirmDelete]}
                            activeOpacity={0.85}
                            disabled={deleting}
                            onPress={confirmDelete}>
                            {deleting ? (
                              <ActivityIndicator size="small" color={Colors.textWhite} />
                            ) : (
                              <Text style={styles.confirmDeleteText}>Delete</Text>
                            )}
                          </TouchableOpacity>
                        </View>
                      </View>
                    ) : (
                      <>
                        <TouchableOpacity
                          style={[styles.sheetBtn, styles.runBtn, running && styles.btnDisabled]}
                          activeOpacity={0.8}
                          disabled={running}
                          onPress={() => onRun(task)}>
                          {running ? (
                            <ActivityIndicator size="small" color={Colors.primary} />
                          ) : (
                            <HugeiconsIcon
                              icon={PlayIcon}
                              size={20}
                              color={Colors.primary}
                              strokeWidth={2}
                            />
                          )}
                          <Text style={[styles.sheetBtnText, { color: Colors.primary }]}>
                            {running ? 'Running…' : 'Run now'}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.sheetBtn, styles.editBtn]}
                          activeOpacity={0.8}
                          onPress={startEdit}>
                          <HugeiconsIcon
                            icon={Edit02Icon}
                            size={20}
                            color={Colors.iconDark}
                            strokeWidth={2}
                          />
                          <Text style={[styles.sheetBtnText, { color: Colors.iconDark }]}>
                            Edit schedule
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.sheetBtn, styles.deleteBtn]}
                          activeOpacity={0.8}
                          onPress={() => setConfirmingDelete(true)}>
                          <HugeiconsIcon
                            icon={Delete02Icon}
                            size={20}
                            color={Colors.error}
                            strokeWidth={2}
                          />
                          <Text style={[styles.sheetBtnText, { color: Colors.error }]}>
                            Delete task
                          </Text>
                        </TouchableOpacity>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <View style={styles.sheetHeader}>
                      <TouchableOpacity
                        style={styles.closeBtn}
                        onPress={() => setMode('overview')}
                        disabled={saving}
                        activeOpacity={0.6}>
                        <HugeiconsIcon
                          icon={ArrowLeft01Icon}
                          size={18}
                          color={Colors.iconDark}
                          strokeWidth={2}
                        />
                      </TouchableOpacity>
                      <Text style={[styles.sheetTitle, styles.flex]}>Edit task</Text>
                    </View>

                    <Text style={styles.fieldLabel}>NAME</Text>
                    <TextInput
                      style={styles.input}
                      value={draft.title}
                      onChangeText={(title) => patchDraft({ title })}
                      maxLength={80}
                      placeholder="Task name"
                      placeholderTextColor={Colors.iconMuted}
                    />

                    <Text style={styles.fieldLabel}>REPEAT</Text>
                    <View style={styles.chipRow}>
                      <Chip
                        label="Every day"
                        selected={draft.frequency === 'daily'}
                        onPress={() => patchDraft({ frequency: 'daily' })}
                      />
                      <Chip
                        label="Every week"
                        selected={draft.frequency === 'weekly'}
                        onPress={() => patchDraft({ frequency: 'weekly' })}
                      />
                    </View>

                    {draft.frequency === 'weekly' && (
                      <>
                        <Text style={styles.fieldLabel}>ON</Text>
                        <View style={styles.chipRow}>
                          {WEEK_ORDER.map((day) => (
                            <Chip
                              key={day.key}
                              label={day.label}
                              selected={draft.weekday === day.key}
                              onPress={() => patchDraft({ weekday: day.key })}
                            />
                          ))}
                        </View>
                      </>
                    )}

                    <Text style={styles.fieldLabel}>TIME ({task.timezone})</Text>
                    <View style={styles.timeRow}>
                      <Stepper
                        label="Hour"
                        value={String(draft.hour12)}
                        onDecrease={() =>
                          patchDraft({ hour12: draft.hour12 === 1 ? 12 : draft.hour12 - 1 })
                        }
                        onIncrease={() =>
                          patchDraft({ hour12: draft.hour12 === 12 ? 1 : draft.hour12 + 1 })
                        }
                      />
                      <Stepper
                        label="Minute"
                        value={String(draft.minute).padStart(2, '0')}
                        onDecrease={() =>
                          patchDraft({
                            minute: draft.minute < 5 ? 55 : Math.floor((draft.minute - 1) / 5) * 5,
                          })
                        }
                        onIncrease={() =>
                          patchDraft({
                            minute: draft.minute >= 55 ? 0 : (Math.floor(draft.minute / 5) + 1) * 5,
                          })
                        }
                      />
                    </View>
                    <View style={[styles.chipRow, styles.ampmRow]}>
                      <Chip
                        label="AM"
                        selected={!draft.pm}
                        onPress={() => patchDraft({ pm: false })}
                      />
                      <Chip
                        label="PM"
                        selected={draft.pm}
                        onPress={() => patchDraft({ pm: true })}
                      />
                    </View>

                    <Text style={styles.preview}>{draftSummary}</Text>

                    <TouchableOpacity
                      style={[
                        styles.sheetBtn,
                        styles.saveBtn,
                        (saving || !draft.title.trim()) && styles.btnDisabled,
                      ]}
                      activeOpacity={0.85}
                      disabled={saving || !draft.title.trim()}
                      onPress={save}>
                      {saving ? (
                        <ActivityIndicator size="small" color={Colors.textWhite} />
                      ) : (
                        <Text style={[styles.sheetBtnText, { color: Colors.textWhite }]}>
                          Save changes
                        </Text>
                      )}
                    </TouchableOpacity>
                  </>
                )}
              </ScrollView>
            </Pressable>
          )}
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  backdrop: {
    flex: 1,
    backgroundColor: Colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  sheet: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '90%',
    backgroundColor: Colors.white,
    borderRadius: 28,
    padding: 20,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 16,
  },
  iconTile: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: Colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetTitleWrap: {
    flex: 1,
    alignItems: 'flex-start',
    gap: 6,
  },
  sheetTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.iconDark,
    letterSpacing: -0.4,
  },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusChipText: {
    fontSize: 12.5,
    fontWeight: '700',
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoCard: {
    backgroundColor: Colors.cardBg,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    borderRadius: 20,
    paddingHorizontal: 16,
    marginBottom: 6,
  },
  infoRow: {
    paddingVertical: 12,
  },
  infoLabel: {
    fontSize: 11.5,
    fontWeight: '700',
    letterSpacing: 0.6,
    color: Colors.iconMuted,
  },
  infoValue: {
    fontSize: 15.5,
    fontWeight: '600',
    color: Colors.iconDark,
    marginTop: 3,
  },
  infoValueMuted: {
    fontWeight: '500',
    color: Colors.iconMuted,
  },
  infoValueError: {
    color: Colors.error,
    fontWeight: '500',
    fontSize: 14,
  },
  infoSub: {
    fontSize: 12.5,
    color: Colors.iconMuted,
    marginTop: 2,
  },
  infoDivider: {
    height: 1,
    backgroundColor: Colors.cardDivider,
  },
  sheetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    height: 52,
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 10,
  },
  sheetBtnText: {
    fontSize: 16,
    fontWeight: '700',
  },
  runBtn: {
    backgroundColor: Colors.primarySubtle,
    borderColor: Colors.primaryBorder,
  },
  editBtn: {
    backgroundColor: Colors.white,
    borderColor: Colors.inputBorder,
  },
  deleteBtn: {
    backgroundColor: Colors.errorLight,
    borderColor: Colors.errorLight,
  },
  saveBtn: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
    marginTop: 18,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  confirmBox: {
    marginTop: 12,
    padding: 16,
    borderRadius: 20,
    backgroundColor: Colors.errorLight,
    gap: 6,
  },
  confirmTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.error,
  },
  confirmText: {
    fontSize: 14,
    lineHeight: 20,
    color: Colors.textSecondary,
  },
  confirmActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  confirmBtn: {
    flex: 1,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmCancel: {
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.inputBorder,
  },
  confirmCancelText: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.iconDark,
  },
  confirmDelete: {
    backgroundColor: Colors.error,
  },
  confirmDeleteText: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textWhite,
  },
  fieldLabel: {
    fontSize: 11.5,
    fontWeight: '700',
    letterSpacing: 0.6,
    color: Colors.iconMuted,
    marginTop: 14,
    marginBottom: 8,
  },
  input: {
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.inputBorder,
    backgroundColor: Colors.cardBg,
    paddingHorizontal: 14,
    fontSize: 16,
    color: Colors.iconDark,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.inputBorder,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipSelected: {
    backgroundColor: Colors.primarySubtle,
    borderColor: Colors.primary,
  },
  chipText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.iconDark,
  },
  chipTextSelected: {
    color: Colors.primary,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  stepper: {
    alignItems: 'center',
  },
  stepperLabel: {
    marginTop: 0,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stepBtn: {
    width: 34,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.inputBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnText: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.iconDark,
  },
  stepValue: {
    minWidth: 30,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '700',
    color: Colors.iconDark,
  },
  ampmRow: {
    marginTop: 12,
  },
  preview: {
    marginTop: 14,
    fontSize: 14,
    fontWeight: '600',
    color: Colors.primary,
  },
});
