export const invoke = async (cmd: string, args?: any) => {
    console.log(`[Mock Tauri] invoke: ${cmd}`, args);
    if (cmd === 'has_analytics_consent_been_asked') return false;
    return null;
};
