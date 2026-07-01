import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Trash2 } from 'lucide-react';
import { IconButton } from '@ui';
import { useController, useSnapshot } from './store';

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
    <div className={`console${collapsed ? ' is-collapsed' : ''}`}>
      <div className="bar console-bar">
        <button
          className="console-toggle"
          title="Toggle console"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((v) => !v)}
        >
          <ChevronDown className="chevron" size={16} aria-hidden />
          <span className="console-title">Console</span>
        </button>
        <span className="console-filters">
          {FILTERS.map(({ level, label }) => (
            <button
              key={level}
              className={`console-filter${filter === level ? ' is-active' : ''}`}
              onClick={() => pickFilter(level)}
            >
              {label}
              {(level === 'error' || level === 'warn') && counts[level] > 0 && (
                <span className="console-count">{counts[level]}</span>
              )}
            </button>
          ))}
        </span>
        <IconButton
          icon={Trash2}
          variant="ghost"
          size="xs"
          className="tool-btn console-clear"
          title="Clear console"
          aria-label="Clear console"
          onClick={c.clearConsoleFromUser}
        />
      </div>
      <div className="console-log" ref={logRef} data-filter={filter} />
    </div>
  );
}
