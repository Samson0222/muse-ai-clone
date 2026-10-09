import Constants from 'expo-constants';

export function getApiUrl(path: string){
    const hostUrl = Constants.expoConfig?.hostUri;
    const cleanPath = path.replace(/^\/+/, '');

    // The Metro dev server only speaks plain http.
    return `http://${hostUrl}/api/${cleanPath}`;
}
