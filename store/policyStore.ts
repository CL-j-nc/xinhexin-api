import { Policy } from '../types/policy.types';

const mockPolicies: Record<string, Policy> = {};

export const policyStore = {
    create(policy: Policy) {
        mockPolicies[policy.policyId] = policy;
        return policy;
    },

    get(policyId: string) {
        return mockPolicies[policyId];
    },

    update(policyId: string, updater: (p: Policy) => void) {
        const policy = mockPolicies[policyId];
        if (!policy) throw new Error('Policy not found');
        updater(policy);
        return policy;
    },

    findByToken(token: string) {
        return Object.values(mockPolicies).find(
            p => p.underwritingInfo?.contractToken === token
        );
    }
};