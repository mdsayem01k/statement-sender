export default function EmptyState({ title, hint }) {
  return (
    <div className="cls-empty">
      <p>{title}</p>
      <span>{hint}</span>
    </div>
  );
}
