export function PageBanner({ title, icon: Icon, detail, children }) {
  return <header className="page-banner">
    <h1 className="page-title"><Icon aria-hidden="true" />{title}</h1>
    {detail && <span className="page-detail">{detail}</span>}
    {children && <div className="page-actions">{children}</div>}
  </header>
}
