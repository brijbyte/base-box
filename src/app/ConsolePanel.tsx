import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Trash2 } from 'lucide-react';
import { IconButton } from '@ui';
import { useController, useSnapshot } from './store';
import styles from './ConsolePanel.module.css';

type Filter = 'all' | 'error' | 'warn' | 'info' | 'log' | 'debug';
const FILTERS: { level: Filter; label: string }[] = [
  { level: 'all', label: 'All' },
  { level: 'error', label: 'Errors' },
  { level: 'warn', label: 'Warnings' },
  { level: 'info', label: 'Info' },
  { level: 'log', label: 'Logs' },
  { level: 'debug', label: 'Debug' },
];

export function ConsolePanel() {
  const c = useController();
  const { counts } = useSnapshot();
  const [collapsed, setCollapsed] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    c.setConsoleLog(logRef.current); // mount-once: register the imperative log sink
    return () => c.setConsoleLog(null);
  }, []);

  const pickFilter = (level: Filter) => {
    setFilter(level);
    setCollapsed(false);
  };

  return (
    <div
      className={`${styles.console}${collapsed ? ` ${styles.isCollapsed}` : ''}`}
    >
      <div className={`bar ${styles.consoleBar}`}>
        <button
          className={styles.consoleToggle}
          title="Toggle console"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((v) => !v)}
        >
          <ChevronDown className={styles.chevron} size={16} aria-hidden />
          <span>Console</span>
        </button>
        <span className={styles.consoleFilters}>
          {FILTERS.map(({ level, label }) => (
            <button
              key={level}
              className={`${styles.consoleFilter}${filter === level ? ` ${styles.isActive}` : ''}`}
              onClick={() => pickFilter(level)}
            >
              {label}
              {(level === 'error' || level === 'warn') && counts[level] > 0 && (
                <span className={styles.consoleCount}>{counts[level]}</span>
              )}
            </button>
          ))}
        </span>
        <IconButton
          icon={Trash2}
          variant="ghost"
          size="xs"
          className={`tool-btn ${styles.consoleClear}`}
          title="Clear console"
          aria-label="Clear console"
          onClick={c.clearConsoleFromUser}
        />
      </div>
      <div className={styles.consoleLog} ref={logRef} data-filter={filter} />
    </div>
  );
}
