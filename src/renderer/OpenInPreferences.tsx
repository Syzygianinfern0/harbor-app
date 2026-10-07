import { availableApps, openApps, type OpenAppId, type OpenInPreferences as Value } from '../shared/openIn';
import { AppIcon, useInstalledApps } from './OpenIn';

/** Preferences → Open in: which apps the Open in menus offer, the one-click default, and a custom command.
 *  Self-contained (value in, value out) so it can move into a settings tab unchanged. */
export function OpenInPreferences({ value, onChange }: { value: Value; onChange: (value: Value) => void }) {
  const installed = useInstalledApps(true);
  const available = availableApps(installed, value);
  const shown = (id: OpenAppId) => !value.hidden.includes(id);
  const fallback = available.find(id => shown(id));
  const current = value.defaultApp && available.includes(value.defaultApp) && shown(value.defaultApp) ? value.defaultApp : fallback;
  const toggle = (id: OpenAppId, on: boolean) => onChange({ ...value, hidden: on ? value.hidden.filter(app => app !== id) : [...value.hidden, id] });
  return <div className="terminal-preferences open-in-preferences">
    <h3>Open folders in your own tools.</h3>
    <p>Choose the apps listed under <strong>Open in</strong> when you right-click a project or chat. The default opens with one click from the chat toolbar, or with ⌘⇧O.</p>
    <div className="open-in-apps" role="group" aria-label="Open in apps">
      {openApps.map(app => {
        const missing = !available.includes(app.id);
        return <div key={app.id} className={`open-in-app ${missing ? 'missing' : ''}`}>
          <label className="toggle-field"><input type="checkbox" aria-label={`Show ${app.label}`} checked={shown(app.id) && !missing} disabled={missing} onChange={event => toggle(app.id, event.target.checked)} /><AppIcon app={app.id} /><span><strong>{app.label}</strong><small>{missing ? app.id === 'custom' ? 'Enter a command below to use it.' : 'Not installed' : app.description}</small></span></label>
          <label className="open-in-default"><input type="radio" name="open-in-default" aria-label={`Use ${app.label} by default`} checked={current === app.id} disabled={missing || !shown(app.id)} onChange={() => onChange({ ...value, defaultApp: app.id })} />Default</label>
        </div>;
      })}
    </div>
    <div className="form-row open-in-custom">
      <label>Custom name<input aria-label="Custom command name" value={value.customLabel} maxLength={40} placeholder="Custom command" onChange={event => onChange({ ...value, customLabel: event.target.value })} /></label>
      <label>Custom command<input aria-label="Custom command" value={value.customCommand} maxLength={2000} placeholder={'open -a "Sublime Text" "$HARBOR_DIR"'} spellCheck={false} onChange={event => onChange({ ...value, customCommand: event.target.value })} /></label>
    </div>
    <p className="preferences-note">The custom command runs with <code>/bin/sh</code> on this Mac. <code>$HARBOR_DIR</code> is the folder (on the SSH host for remote projects) and <code>$HARBOR_HOST</code> is the SSH host, empty on this Mac. Quote them, as in the example. Finder is not offered for SSH projects.</p>
  </div>;
}
