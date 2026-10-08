import type { ReactNode } from 'react';
import { Check } from 'lucide-react';

export const cleanError = (error: unknown) => (error as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '');

/** A labelled setting with its control on the right. `anchor` is what search results scroll to. */
export function SettingRow({ anchor, label, detail, children, stack }: { anchor?: string; label: ReactNode; detail?: ReactNode; children?: ReactNode; stack?: boolean }) {
  return <div className={`settings-row ${stack ? 'stack' : ''}`} data-setting={anchor}><div className="settings-row-text"><strong>{label}</strong>{detail && <small>{detail}</small>}</div>{children && <div className="settings-row-control">{children}</div>}</div>;
}
export function SettingsGroup({ title, children }: { title?: ReactNode; children: ReactNode }) {
  return <section className="settings-group">{title && <h3 className="settings-group-title">{title}</h3>}<div className="settings-rows">{children}</div></section>;
}
export function PageHeading({ title, description, saved, crumb }: { title: ReactNode; description?: ReactNode; saved: boolean; crumb?: ReactNode }) {
  return <header className="settings-heading">{crumb && <div className="settings-crumb">{crumb}</div>}<h2>{title}<span className={`settings-saved ${saved ? 'on' : ''}`} role="status" aria-hidden={!saved}>{saved && <><Check size={12}/>Saved</>}</span></h2>{description && <p>{description}</p>}</header>;
}
