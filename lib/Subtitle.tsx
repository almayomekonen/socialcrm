export default function Subtitle({ lbl, className = '' }) {
  return <h1 className={`text-lg font-bold ${className}`}>{lbl}</h1>
}
