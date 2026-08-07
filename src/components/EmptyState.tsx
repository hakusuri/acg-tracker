import type { ReactNode } from 'react';

interface Props {
  icon?: string;
  title: string;
  desc?: string;
  children?: ReactNode;
}

export default function EmptyState({ icon, title, desc, children }: Props) {
  return (
    <div className="empty glass">
      {icon && <div className="empty-icon">{icon}</div>}
      <h3>{title}</h3>
      {desc && <p>{desc}</p>}
      {children && <div className="empty-actions">{children}</div>}
    </div>
  );
}