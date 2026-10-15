import { MiMark } from "./MiMark";
import type { MiniMiCharacter } from "@/lib/theme/preferences";
import type { MiniMiActivity } from "@/lib/theme/useMiniMi";

/** A tiny drafting companion. Token colors and the shared mark keep it part of Mi. */
export function MiAvatar({ className = "", character = "robot", activity = "idle", animated = true }: {
  className?: string; character?: MiniMiCharacter; activity?: MiniMiActivity; animated?: boolean;
}) {
  return <span className={`mi-avatar relative inline-block ${className}`} data-character={character} data-activity={activity} data-animated={animated} aria-hidden="true">
    <svg viewBox="0 0 72 80" fill="none" className="h-full w-full" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="36" cy="74" rx="20" ry="3" fill="currentColor" opacity=".1" />
      <g className="mi-avatar-body">
        {character === "robot" && <>
        <path d="M36 13V7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <circle cx="36" cy="5" r="3" fill="var(--accent)" />
        <path d="M22 50L16 61" stroke="currentColor" strokeWidth="4" /><g className="mi-avatar-arm">
        <path d="M50 50L57 42" stroke="currentColor" strokeWidth="4" />
        <path d="M55 45L61 29" stroke="var(--accent)" strokeWidth="4" strokeLinecap="round" />
        <path d="M61 29L62 24L64 28Z" fill="currentColor" />
        </g>
        <rect x="22" y="43" width="28" height="23" rx="8" fill="var(--card)" stroke="currentColor" strokeWidth="1.5" />
        <path className="mi-avatar-foot-left" d="M27 66V70" stroke="currentColor" strokeWidth="5" /><path className="mi-avatar-foot-right" d="M45 66V70" stroke="currentColor" strokeWidth="5" />
        <rect x="12" y="15" width="48" height="32" rx="13" fill="var(--card)" stroke="currentColor" strokeWidth="1.5" />
        <rect x="18" y="21" width="36" height="20" rx="9" fill="var(--accent)" opacity=".12" />
        <Face y={26} activity={activity} />
        <g transform="translate(27 47)"><MiMark size={18} className="text-accent" /></g>
        </>}
        {character === "paper" && <>
          <path d="M18 10H46L58 22V64Q36 59 14 64Z" fill="var(--card)" stroke="currentColor" strokeWidth="1.6" />
          <path d="M46 10V23H58" fill="var(--accent)" fillOpacity=".15" stroke="currentColor" strokeWidth="1.6" />
          <path d="M15 41L9 48" stroke="currentColor" strokeWidth="2.5" /><path className="mi-avatar-foot-left" d="M27 64L25 69" stroke="currentColor" strokeWidth="2.5" /><path className="mi-avatar-foot-right" d="M45 64L48 69" stroke="currentColor" strokeWidth="2.5" />
          <path className="mi-avatar-arm" d="M57 44L64 37" stroke="currentColor" strokeWidth="2.5" />
          <Face y={33} activity={activity} /><path d="M23 51H38M23 56H32" stroke="var(--accent)" strokeWidth="1.5" opacity=".5" />
          <g transform="translate(35 47)"><MiMark size={20} className="text-accent" /></g>
        </>}
        {character === "spark" && <>
          <path d="M36 10C39 24 47 28 62 33C47 38 43 47 39 64C34 50 24 44 9 40C24 34 31 26 36 10Z" fill="var(--accent)" fillOpacity=".16" stroke="var(--accent)" strokeWidth="1.8" />
          <Face y={32} activity={activity} /><path className="mi-avatar-arm" d="M56 12V20M52 16H60M13 57V63M10 60H16" stroke="var(--accent)" strokeWidth="1.4" />
        </>}
        {character === "owl" && <>
          <path d="M17 28L15 12L33 22H39L57 12L55 29Q61 37 59 49Q56 66 36 67Q13 66 12 48Q11 36 17 28Z" fill="var(--card)" stroke="currentColor" strokeWidth="1.7" />
          <path d="M16 42Q21 49 20 57" stroke="currentColor" strokeWidth="2" /><path className="mi-avatar-foot-left" d="M26 66L24 70" stroke="currentColor" strokeWidth="2" /><path className="mi-avatar-foot-right" d="M46 66L48 70" stroke="currentColor" strokeWidth="2" />
          <path className="mi-avatar-arm" d="M56 42Q51 49 52 57" stroke="var(--accent)" strokeWidth="2" />
          {[26,46].map(x => <circle key={x} cx={x} cy="35" r="10" fill="var(--accent)" fillOpacity=".12" stroke="var(--accent)" strokeWidth="1.3" />)}
          <Face y={32} activity={activity} owl />
          <g transform="translate(24 45)"><MiMark size={24} className="text-accent" /></g>
        </>}
        {activity === "thinking" && <g className="mi-avatar-thought" fill="var(--accent)"><circle cx="59" cy="22" r="1.5" /><circle cx="63" cy="16" r="2" /><circle cx="65" cy="8" r="3" /></g>}
        {activity === "working" && <g><path d="M16 55H56L53 69H19Z" fill="var(--card)" stroke="var(--accent)" strokeWidth="1.6" /><path d="M13 70H59" stroke="currentColor" strokeWidth="2" /><path className="mi-avatar-typing" d="M27 60H32M37 60H42M25 64H45" stroke="var(--accent)" strokeWidth="1.5" /></g>}
        {activity === "drafting" && <g><path d="M16 57H49L55 70H11Z" fill="var(--card)" stroke="currentColor" strokeWidth="1.4" /><path d="M22 62H37V67H22Z" stroke="var(--accent)" strokeWidth="1" /><g className="mi-avatar-pencil"><path d="M35 64L53 45" stroke="var(--accent)" strokeWidth="3" /><path d="M35 64L33 67L37 65" fill="currentColor" /></g></g>}
        {activity === "eating" && <g className="mi-avatar-snack"><path d="M58 39A10 10 0 1 1 47 28Q46 33 51 32Q50 38 58 39Z" fill="var(--card)" stroke="var(--accent)" strokeWidth="1.6" /><g fill="var(--accent)"><circle cx="43" cy="36" r="1.2" /><circle cx="47" cy="43" r="1.2" /><circle cx="40" cy="43" r="1" /></g></g>}
        {activity === "singing" && <g className="mi-avatar-notes" stroke="var(--accent)" strokeWidth="1.5"><path d="M54 24V12L61 10V21" /><ellipse cx="52" cy="24" rx="2" ry="1.5" fill="var(--accent)" /><ellipse cx="59" cy="21" rx="2" ry="1.5" fill="var(--accent)" /></g>}
        {activity === "sleeping" && <g className="mi-avatar-sleep" stroke="var(--accent)" strokeWidth="1.5"><path d="M56 20H61L56 25H61M60 8H67L60 15H67" /></g>}
      </g>
    </svg>
  </span>;
}

function Face({ y, activity, owl = false }: { y: number; activity: MiniMiActivity; owl?: boolean }) {
  const happy = activity === "happy";
  const sleeping = activity === "sleeping";
  const sad = activity === "sad";
  const angry = activity === "angry";
  return <>
    <g className="mi-avatar-eyes" fill="var(--foreground)">
      {happy || sleeping ? <path d={`M24 ${y + 4} Q27 ${y + (happy ? -1 : 8)} 30 ${y + 4} M42 ${y + 4} Q45 ${y + (happy ? -1 : 8)} 48 ${y + 4}`} fill="none" stroke="var(--foreground)" strokeWidth="1.7" /> : <><rect x="25" y={y} width="4" height="7" rx="2" /><rect x="43" y={y} width="4" height="7" rx="2" /></>}
    </g>
    {(angry || sad) && <path className="mi-avatar-brows" d={angry ? `M23 ${y - 3}L30 ${y}M42 ${y}L49 ${y - 3}` : `M23 ${y}L30 ${y - 3}M42 ${y - 3}L49 ${y}`} stroke="var(--foreground)" strokeWidth="1.7" />}
    {activity === "singing" ? <ellipse className="mi-avatar-mouth" cx="36" cy={y + 11} rx="3" ry="4" fill="var(--foreground)" />
      : owl && !sad && !angry && !happy && !sleeping ? <path className="mi-avatar-mouth" d="M33 44L36 48L39 44" fill="var(--accent)" />
      : <path className="mi-avatar-mouth" d={`M32 ${y + 10} Q36 ${y + (sad || angry ? 6 : happy ? 16 : sleeping ? 10 : 14)} 40 ${y + 10}`} stroke="var(--foreground)" strokeWidth="1.5" />}
    {sad && <path className="mi-avatar-tear" d={`M48 ${y + 7} Q53 ${y + 14} 48 ${y + 14} Q44 ${y + 14} 48 ${y + 7}`} fill="var(--accent)" />}
  </>;
}
