/**
 * Instance profile (see design plan section 7f). Phase 0 only defines the shape and EU defaults.
 * Everything instance-specific (name, domain, region, policy pack) lives here, never hard-coded elsewhere.
 */
export interface InstanceProfile {
  name: string;
  region: 'eu' | 'us' | 'other';
  policyPack: string;
  localOnly: boolean;
}

export const DEFAULT_PROFILE: InstanceProfile = {
  name: 'Rogue',
  region: 'eu',
  policyPack: 'eu-default',
  localOnly: false,
};

export function loadProfile(env: Record<string, string | undefined> = {}): InstanceProfile {
  const region = env['ROGUE_REGION'];
  return {
    name: env['ROGUE_INSTANCE_NAME'] ?? DEFAULT_PROFILE.name,
    region: region === 'us' || region === 'other' ? region : 'eu',
    policyPack: env['ROGUE_POLICY_PACK'] ?? DEFAULT_PROFILE.policyPack,
    localOnly: env['ROGUE_LOCAL_ONLY'] === 'true',
  };
}
