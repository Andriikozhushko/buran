interface MascotProps {
  state: 'idle' | 'scanning' | 'cleaning' | 'success';
}

export function Mascot({ state }: MascotProps) {
  const animClass = {
    idle: '',
    scanning: 'animate-mascot-sniff',
    cleaning: 'animate-mascot-eat',
    success: 'animate-mascot-satisfied',
  }[state];

  const bellyScale = state === 'success' ? 1.15 : state === 'cleaning' ? 1.05 : 1;
  const mouthOpen = state === 'cleaning' || state === 'success';

  return (
    <div className={`flex justify-center transition-all duration-500 ${animClass}`} role="img" aria-label={`Буран — ${state === 'idle' ? 'ожидает' : state === 'scanning' ? 'ищет следы' : state === 'cleaning' ? 'ест метаданные' : 'доволен'}`}>
      <svg
        viewBox="0 0 200 180"
        className="w-32 h-28 md:w-40 md:h-36 transition-all duration-500"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Ears */}
        <polygon points="45,45 55,10 75,35" fill="#b8834a" stroke="#1e1e2a" strokeWidth="1.5" />
        <polygon points="125,35 145,10 155,45" fill="#b8834a" stroke="#1e1e2a" strokeWidth="1.5" />
        {/* Inner ears */}
        <polygon points="52,40 58,18 70,35" fill="#f0dcc8" />
        <polygon points="130,35 142,18 148,40" fill="#f0dcc8" />

        {/* Head */}
        <ellipse cx="100" cy="65" rx="48" ry="42" fill="#d4a373" stroke="#1e1e2a" strokeWidth="1.5" />

        {/* Face markings — Akita style */}
        <ellipse cx="100" cy="72" rx="30" ry="25" fill="#f0dcc8" />

        {/* Eyes */}
        <g className="transition-all duration-300">
          <ellipse cx="82" cy="58" rx="5" ry="5.5" fill="#1e1e2a" />
          <ellipse cx="118" cy="58" rx="5" ry="5.5" fill="#1e1e2a" />
          {/* Eye shine */}
          <ellipse cx="84" cy="56" rx="1.8" ry="1.8" fill="white" />
          <ellipse cx="120" cy="56" rx="1.8" ry="1.8" fill="white" />
        </g>

        {/* Alert eyebrows (idle/scanning) */}
        {!mouthOpen && (
          <g>
            <line x1="74" y1="50" x2="88" y2="52" stroke="#1e1e2a" strokeWidth="2" strokeLinecap="round" />
            <line x1="112" y1="52" x2="126" y2="50" stroke="#1e1e2a" strokeWidth="2" strokeLinecap="round" />
          </g>
        )}

        {/* Nose */}
        <ellipse cx="100" cy="68" rx="6" ry="4.5" fill="#1e1e2a" />
        <ellipse cx="98.5" cy="67" rx="2" ry="1.2" fill="#4a4a5a" />

        {/* Mouth */}
        {mouthOpen ? (
          <ellipse cx="100" cy="78" rx="8" ry="6" fill="#1e1e2a" />
        ) : (
          <path d="M93,76 Q100,80 107,76" stroke="#1e1e2a" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        )}

        {/* Tongue (only when mouth open) */}
        {mouthOpen && (
          <ellipse cx="100" cy="81" rx="4" ry="3" fill="#c4746e" />
        )}

        {/* Whisker dots */}
        <circle cx="73" cy="70" r="1.5" fill="#b8834a" />
        <circle cx="78" cy="75" r="1.5" fill="#b8834a" />
        <circle cx="122" cy="75" r="1.5" fill="#b8834a" />
        <circle cx="127" cy="70" r="1.5" fill="#b8834a" />

        {/* Body */}
        <ellipse
          cx="100"
          cy="125"
          rx="35"
          ry="32"
          fill="#d4a373"
          stroke="#1e1e2a"
          strokeWidth="1.5"
          style={{ transform: `scale(${bellyScale})`, transformOrigin: '100px 125px', transition: 'transform 0.5s ease-out' }}
        />

        {/* Chest/belly lighter area */}
        <ellipse
          cx="100"
          cy="130"
          rx="22"
          ry="20"
          fill="#f0dcc8"
          style={{ transform: `scale(${bellyScale})`, transformOrigin: '100px 130px', transition: 'transform 0.5s ease-out' }}
        />

        {/* Front paws */}
        <ellipse cx="78" cy="150" rx="10" ry="7" fill="#d4a373" stroke="#1e1e2a" strokeWidth="1.5" />
        <ellipse cx="122" cy="150" rx="10" ry="7" fill="#d4a373" stroke="#1e1e2a" strokeWidth="1.5" />

        {/* Paw details */}
        <ellipse cx="74" cy="151" rx="2" ry="2" fill="#b8834a" />
        <ellipse cx="78" cy="153" rx="2" ry="2" fill="#b8834a" />
        <ellipse cx="82" cy="151" rx="2" ry="2" fill="#b8834a" />
        <ellipse cx="118" cy="151" rx="2" ry="2" fill="#b8834a" />
        <ellipse cx="122" cy="153" rx="2" ry="2" fill="#b8834a" />
        <ellipse cx="126" cy="151" rx="2" ry="2" fill="#b8834a" />

        {/* Scanning sniff trail */}
        {state === 'scanning' && (
          <>
            <circle cx="155" cy="65" r="3" fill="#b8d4e8" opacity="0.6">
              <animate attributeName="opacity" values="0.6;0;0.6" dur="1.5s" repeatCount="indefinite" />
            </circle>
            <circle cx="168" cy="58" r="2" fill="#b8d4e8" opacity="0.4">
              <animate attributeName="opacity" values="0.4;0;0.4" dur="1.5s" begin="0.3s" repeatCount="indefinite" />
            </circle>
            <circle cx="175" cy="52" r="1.5" fill="#b8d4e8" opacity="0.3">
              <animate attributeName="opacity" values="0.3;0;0.3" dur="1.5s" begin="0.6s" repeatCount="indefinite" />
            </circle>
          </>
        )}

        {/* Eating — metadata particles */}
        {state === 'cleaning' && (
          <>
            <rect x="140" y="70" width="4" height="4" rx="1" fill="#6a9ec3" opacity="0.8">
              <animate attributeName="y" values="70;35" dur="0.8s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.8;0" dur="0.8s" repeatCount="indefinite" />
            </rect>
            <rect x="150" y="75" width="3" height="3" rx="1" fill="#c4872b" opacity="0.8">
              <animate attributeName="y" values="75;40" dur="0.7s" begin="0.2s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.8;0" dur="0.7s" repeatCount="indefinite" />
            </rect>
            <rect x="145" y="80" width="5" height="3" rx="1" fill="#5a5d6e" opacity="0.7">
              <animate attributeName="y" values="80;45" dur="0.9s" begin="0.4s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.7;0" dur="0.9s" repeatCount="indefinite" />
            </rect>
            <rect x="155" y="72" width="3" height="4" rx="1" fill="#6a9ec3" opacity="0.7">
              <animate attributeName="y" values="72;38" dur="0.6s" begin="0.15s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.7;0" dur="0.6s" repeatCount="indefinite" />
            </rect>
          </>
        )}

        {/* Success — checkmark */}
        {state === 'success' && (
          <g>
            <circle cx="150" cy="55" r="14" fill="#e8f5ef" stroke="#3d7d5c" strokeWidth="2" />
            <path d="M143,55 L148,60 L157,49" stroke="#3d7d5c" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </g>
        )}

        {/* Tail — curled up behind */}
        <path
          d="M65,130 Q45,110 50,90 Q55,75 65,82"
          fill="none"
          stroke="#b8834a"
          strokeWidth="6"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}
