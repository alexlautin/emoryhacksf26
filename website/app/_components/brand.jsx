export function Pug({ size = 44, className = '' }) {
  return <img className={`pug ${className}`} src="/ui/pug.png" width={size} height={size} alt="" />;
}

export default function Brand() {
  return <a className="brand" href="/" aria-label="Harness, home"><Pug size={40} /><span>Harness</span></a>;
}
