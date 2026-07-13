import { useT } from '../i18n';

function TrustIcon({ type }: { type: string }) {
  const paths: Record<string, React.JSX.Element> = {
    local: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25"
      />
    ),
    noreg: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0M17.25 10h.008v.008h-.008V10z"
      />
    ),
    nostorage: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m6 4.125l2.25 2.25m0 0l2.25 2.25M12 13.875l2.25-2.25M12 13.875l-2.25 2.25M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z"
      />
    ),
    opensource: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5"
      />
    ),
  };

  return (
    <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
      {paths[type]}
    </svg>
  );
}

export function TrustRow() {
  const t = useT();
  const items = [
    { key: 'local', text: t.trustLocal },
    { key: 'noreg', text: t.trustNoReg },
    { key: 'nostorage', text: t.trustNoStorage },
    { key: 'opensource', text: t.trustOpenSource },
  ] as const;

  return (
    <div className="flex flex-wrap justify-center gap-4 md:gap-8 mt-8">
      {items.map((item) => (
        <div key={item.key} className="flex items-center gap-2 text-sm text-buran-text-secondary">
          <TrustIcon type={item.key} />
          <span>{item.text}</span>
        </div>
      ))}
    </div>
  );
}
