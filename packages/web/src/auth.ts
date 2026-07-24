/**
 * Native Cognito auth (T-14 · R-60) via amazon-cognito-identity-js (SRP).
 * Demo users are admin-created with a permanent password (T-08), so there is no
 * NEW_PASSWORD_REQUIRED step; sign-in returns the access token directly.
 */
import { CognitoUserPool, CognitoUser, AuthenticationDetails } from 'amazon-cognito-identity-js';
import { config } from './config.js';

const pool = new CognitoUserPool({
  UserPoolId: config.userPoolId,
  ClientId: config.userPoolClientId,
});

export function signIn(username: string, password: string): Promise<string> {
  const user = new CognitoUser({ Username: username, Pool: pool });
  const details = new AuthenticationDetails({ Username: username, Password: password });
  return new Promise((resolve, reject) => {
    user.authenticateUser(details, {
      onSuccess: (session) => resolve(session.getAccessToken().getJwtToken()),
      onFailure: reject,
    });
  });
}

/** Resume a stored session's access token, if any. */
export function currentToken(): Promise<string | undefined> {
  const user = pool.getCurrentUser();
  if (!user) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    user.getSession((err: unknown, session: any) => {
      if (err || !session?.isValid()) return resolve(undefined);
      resolve(session.getAccessToken().getJwtToken());
    });
  });
}

export function signOut(): void {
  pool.getCurrentUser()?.signOut();
}
