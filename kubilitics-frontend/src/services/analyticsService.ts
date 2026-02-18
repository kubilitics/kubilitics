export const analyticsService = {
    trackEvent: (category: string, action: string, label?: string) => {
        console.log('[Analytics Stub] trackEvent:', category, action, label);
    },
    init: () => {
        console.log('[Analytics Stub] init');
    },
    pageView: (path: string) => {
        console.log('[Analytics Stub] pageView:', path);
    },
    trackFeatureUsage: (feature: string, action: string) => {
        console.log('[Analytics Stub] trackFeatureUsage:', feature, action);
    },
    trackAppStart: () => {
        console.log('[Analytics Stub] trackAppStart');
    }
};
