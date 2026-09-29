// 저장 키: 싱글 페이지는 'pcs-…' 로 따로 저장 (싱글 파티가 더블 파티를 덮어쓰지 않게)
const MODE = (typeof window !== 'undefined' && window.__DATA__ && window.__DATA__.mode) || 'doubles';
export const skey = k => (MODE === 'singles' ? k.replace(/^pc-/, 'pcs-') : k);
