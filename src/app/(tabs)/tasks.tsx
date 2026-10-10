/**
 * Tasks Tab Screen ('/(tabs)/tasks')
 *
 * Recurring agent tasks saved in Supabase (`scheduled_agent_tasks`):
 * - Lists the signed-in user's schedules on every focus
 * - Pause / resume with the switch
 * - "Manage" opens a sheet to run a task now (through the `agent-run` Edge
 *   Function), edit its schedule, or delete it
 * - New schedules are created from chat, after the user confirms
 */

import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { HugeiconsIcon } from '@hugeicons/react-native';
import {
  Add01Icon,
  Target01Icon,
  Clock01Icon,
} from '@hugeicons/core-free-icons';
import { Colors } from '@/constants/colors';
import { showToast } from '@/context/ToastContext';
import { TaskManageSheet } from '@/components/common/TaskManageSheet';
import {
  deleteScheduledTask,
  describeDelivery,
  describeLastRun,
  describeTaskNextRun,
  describeTaskSchedule,
  listScheduledTasks,
  runScheduledTaskNow,
  setScheduledTaskActive,
  updateScheduledTask,
  type ScheduledTask,
  type ScheduledTaskEdit,
} from '@/services/scheduledTasks';

/** Shared size of the toggle and the Manage button. */
const CONTROL_WIDTH = 84;
const CONTROL_HEIGHT = 34;

/**
 * On/off toggle drawn at the exact size of the Manage button (the native Switch
 * has a platform-specific size), so the two stack as one aligned column.
 */
function PillSwitch({
  value,
  disabled,
  onToggle,
}: {
  value: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <TouchableOpacity
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled: !!disabled }}
      activeOpacity={0.8}
      disabled={disabled}
      onPress={onToggle}
      style={[
        styles.pillSwitch,
        value ? styles.pillSwitchOn : styles.pillSwitchOff,
        value ? styles.pillSwitchAlignEnd : styles.pillSwitchAlignStart,
        disabled && styles.pillSwitchDisabled,
      ]}>
      <View style={styles.pillSwitchThumb} />
    </TouchableOpacity>
  );
}

export default function TasksScreen() {
  const router = useRouter();
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Ids with a pause/resume or run in flight. */
  const [busyIds, setBusyIds] = useState<string[]>([]);
  /** Task open in the manage sheet. */
  const [managingId, setManagingId] = useState<string | null>(null);
  // Derived from the list so the open sheet follows every refresh.
  const managedTask = tasks.find((t) => t.id === managingId) ?? null;

  const load = useCallback(async () => {
    try {
      setTasks(await listScheduledTasks());
      setLoadError(null);
    } catch (error: any) {
      setLoadError(error?.message ?? 'Could not load your tasks');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Reload whenever the tab is shown, so a task confirmed in chat appears.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const setBusy = (id: string, busy: boolean) =>
    setBusyIds((prev) =>
      busy ? [...prev, id] : prev.filter((item) => item !== id),
    );

  const handleToggle = async (task: ScheduledTask) => {
    const resume = task.status !== 'active';
    setBusy(task.id, true);
    try {
      const updated = await setScheduledTaskActive(task, resume);
      setTasks((prev) => prev.map((t) => (t.id === task.id ? updated : t)));
      showToast(resume ? `${task.title} resumed` : `${task.title} paused`);
    } catch (error: any) {
      showToast(error?.message ?? 'Could not update the task');
    } finally {
      setBusy(task.id, false);
    }
  };

  const handleRun = async (task: ScheduledTask) => {
    setManagingId(null);
    setBusy(task.id, true);
    showToast(`Running ${task.title}...`);
    try {
      await runScheduledTaskNow(task.id);
      showToast(
        task.delivery === 'chat'
          ? `${task.title} finished. The result is in your chat.`
          : `${task.title} finished`,
      );
    } catch (error: any) {
      showToast(error?.message ?? 'The run failed');
    } finally {
      setBusy(task.id, false);
      load();
    }
  };

  const handleSaveEdit = async (task: ScheduledTask, edit: ScheduledTaskEdit) => {
    try {
      const updated = await updateScheduledTask(task, edit);
      setTasks((prev) => prev.map((t) => (t.id === task.id ? updated : t)));
      showToast('Task updated');
    } catch (error: any) {
      showToast(error?.message ?? 'Could not save the task');
      throw error;
    }
  };

  const handleDelete = async (task: ScheduledTask) => {
    try {
      await deleteScheduledTask(task.id);
      setTasks((prev) => prev.filter((t) => t.id !== task.id));
      setManagingId(null);
      showToast(`${task.title} deleted`);
    } catch (error: any) {
      showToast(error?.message ?? 'Could not delete the task');
      throw error;
    }
  };

  const handleNew = () => {
    showToast('Tell Cooper what to schedule, e.g. "every morning at 8"');
    router.push('/(tabs)/chat' as any);
  };

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollArea}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
          />
        }>
        {/* Page Title & "+ New" Button */}
        <View style={styles.headerRow}>
          <Text style={styles.pageTitle}>Scheduled Agents & Goals</Text>
          <TouchableOpacity
            style={styles.newGoalBtn}
            onPress={handleNew}
            activeOpacity={0.8}>
            <HugeiconsIcon icon={Add01Icon} size={15} color={Colors.white} strokeWidth={2.4} />
            <Text style={styles.newGoalText}>New</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <ActivityIndicator style={styles.stateBlock} color={Colors.primary} />
        ) : loadError ? (
          <View style={styles.stateBlock}>
            <Text style={styles.stateText}>{loadError}</Text>
            <TouchableOpacity onPress={load} activeOpacity={0.8}>
              <Text style={styles.stateLink}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : tasks.length === 0 ? (
          <View style={styles.stateBlock}>
            <Text style={styles.stateText}>
              No scheduled tasks yet. Ask Cooper in chat, for example "send me
              Hacker News top 5 every morning at 8 AM".
            </Text>
          </View>
        ) : null}

        {/* Task Rows */}
        {tasks.map((task, index) => {
          const isActive = task.status === 'active';
          const busy = busyIds.includes(task.id);
          const lastRun = describeLastRun(task);
          const lastFailed = task.lastRunStatus === 'failed';

          return (
            <View key={task.id}>
              <View style={styles.taskRow}>
                {/* Left Target Icon Badge */}
                <View
                  style={[
                    styles.iconContainer,
                    { backgroundColor: isActive ? Colors.primarySubtle : Colors.surfaceMuted },
                  ]}>
                  <HugeiconsIcon
                    icon={Target01Icon}
                    size={20}
                    color={isActive ? Colors.primary : Colors.textMuted}
                    strokeWidth={2}
                  />
                </View>

                {/* Center Content */}
                <View style={styles.textContainer}>
                  <Text style={[styles.taskTitle, !isActive && styles.pausedText]}>
                    {task.title}
                  </Text>

                  <View style={styles.metaRow}>
                    <View style={styles.scheduleItem}>
                      <HugeiconsIcon icon={Clock01Icon} size={12} color={Colors.textMuted} />
                      <Text style={styles.taskSchedule}>{describeTaskSchedule(task)}</Text>
                    </View>
                    <Text style={styles.metaDot}>•</Text>
                    <Text style={styles.executionsText}>{describeDelivery(task.delivery)}</Text>
                  </View>

                  <Text style={styles.statusLine} numberOfLines={2}>
                    {isActive ? `Next: ${describeTaskNextRun(task)}` : 'Paused'}
                  </Text>
                  {lastRun ? (
                    <Text
                      style={[styles.statusLine, lastFailed && styles.statusFailed]}
                      numberOfLines={2}>
                      {lastFailed
                        ? `Last run failed (${lastRun}): ${task.lastRunError ?? 'unknown error'}`
                        : `Last run ${lastRun}: completed`}
                    </Text>
                  ) : null}
                </View>

                {/* Right Controls: Switch & Run Button */}
                <View style={styles.actionsCol}>
                  <PillSwitch
                    value={isActive}
                    disabled={busy}
                    onToggle={() => handleToggle(task)}
                  />

                  <TouchableOpacity
                    style={styles.manageBtn}
                    onPress={() => setManagingId(task.id)}
                    activeOpacity={0.75}>
                    {busy ? (
                      <ActivityIndicator size="small" color={Colors.iconDark} />
                    ) : (
                      <Text style={styles.manageBtnText}>Manage</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>

              {index < tasks.length - 1 && <View style={styles.divider} />}
            </View>
          );
        })}
      </ScrollView>

      <TaskManageSheet
        task={managedTask}
        running={!!managedTask && busyIds.includes(managedTask.id)}
        onClose={() => setManagingId(null)}
        onRun={handleRun}
        onSave={handleSaveEdit}
        onDelete={handleDelete}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.white,
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 24,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
  },
  pageTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: Colors.iconDark,
    letterSpacing: -0.5,
    flex: 1,
    paddingRight: 12,
  },
  newGoalBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primary,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 12,
    gap: 4,
  },
  newGoalText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.white,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 18,
    gap: 14,
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textContainer: {
    flex: 1,
  },
  taskTitle: {
    fontSize: 15.5,
    fontWeight: '700',
    color: Colors.iconDark,
    lineHeight: 21,
    letterSpacing: -0.2,
  },
  pausedText: {
    color: Colors.textMuted,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 5,
  },
  scheduleItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  taskSchedule: {
    fontSize: 13,
    color: '#707070',
    fontWeight: '500',
    letterSpacing: -0.1,
  },
  metaDot: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  executionsText: {
    fontSize: 13,
    color: '#707070',
    fontWeight: '500',
  },
  statusLine: {
    marginTop: 4,
    fontSize: 12.5,
    color: Colors.textMuted,
    fontWeight: '500',
  },
  statusFailed: {
    color: Colors.error,
  },
  actionsCol: {
    alignItems: 'flex-end',
    gap: 8,
  },
  pillSwitch: {
    width: CONTROL_WIDTH,
    height: CONTROL_HEIGHT,
    borderRadius: CONTROL_HEIGHT / 2,
    padding: 3,
    justifyContent: 'center',
  },
  pillSwitchOn: {
    backgroundColor: Colors.primary,
  },
  pillSwitchOff: {
    backgroundColor: Colors.border,
  },
  pillSwitchAlignStart: {
    alignItems: 'flex-start',
  },
  pillSwitchAlignEnd: {
    alignItems: 'flex-end',
  },
  pillSwitchDisabled: {
    opacity: 0.55,
  },
  pillSwitchThumb: {
    width: CONTROL_HEIGHT - 6,
    height: CONTROL_HEIGHT - 6,
    borderRadius: (CONTROL_HEIGHT - 6) / 2,
    backgroundColor: Colors.white,
  },
  manageBtn: {
    width: CONTROL_WIDTH,
    height: CONTROL_HEIGHT,
    paddingHorizontal: 0,
    borderRadius: CONTROL_HEIGHT / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.inputBorder,
  },
  manageBtnText: {
    fontSize: 13.5,
    fontWeight: '700',
    color: Colors.iconDark,
  },
  stateBlock: {
    paddingHorizontal: 20,
    paddingVertical: 28,
    alignItems: 'center',
    gap: 10,
  },
  stateText: {
    fontSize: 14.5,
    lineHeight: 21,
    textAlign: 'center',
    color: Colors.textSecondary,
  },
  stateLink: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.primary,
  },
  divider: {
    height: 1,
    backgroundColor: '#F0F0F2',
    marginHorizontal: 20,
  },
});
