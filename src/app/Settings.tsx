import { useState } from 'react';
import { Settings as SettingsIcon } from 'lucide-react';
import { Popover, Select, RadioGroup, Button, IconButton } from '@ui';
import { THEMES, type Mode } from '../theme';
import { useController, useSnapshot } from './store';
import styles from './Settings.module.css';

const MODE_OPTIONS = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

const TEMPLATE_OPTIONS = [
  { value: 'react', label: 'React + Base UI' },
  { value: 'vue', label: 'Vue 3' },
];

export function Settings() {
  const c = useController();
  const { mode, appearance, colorTheme } = useSnapshot();
  const [open, setOpen] = useState(false);
  const [templateKey, setTemplateKey] = useState(0);

  const themeOptions = THEMES[appearance].map((t) => ({
    value: t.id,
    label: t.label,
  }));

  return (
    <div className="settings">
      <Popover
        open={open}
        onOpenChange={setOpen}
        side="top"
        align="end"
        trigger={
          <IconButton
            icon={SettingsIcon}
            variant="ghost"
            size="xs"
            className="tool-btn"
            id="settings"
            title="Settings"
            aria-label="Settings"
          />
        }
      >
        <div className={styles.settingsContent}>
          <Button
            variant="soft"
            size="sm"
            onClick={async () => {
              await c.share();
              setOpen(false);
            }}
          >
            Share URL
          </Button>

          <label className={styles.settingRow}>
            <span>New project</span>
            <Select
              key={templateKey}
              placeholder="Template…"
              options={TEMPLATE_OPTIONS}
              onValueChange={(value) => {
                if (!value) return;
                setOpen(false);
                setTemplateKey((k) => k + 1); // snap back to the placeholder
                void c.loadTemplate(value);
              }}
            />
          </label>

          <div className={styles.settingRow}>
            <span>Mode</span>
            <RadioGroup
              options={MODE_OPTIONS}
              value={mode}
              onValueChange={(value) => void c.setMode(value as Mode)}
            />
          </div>

          <label className={styles.settingRow}>
            <span>Color theme</span>
            <Select
              options={themeOptions}
              value={colorTheme}
              onValueChange={(value) => value && c.setColorTheme(value)}
            />
          </label>
        </div>
      </Popover>
    </div>
  );
}
