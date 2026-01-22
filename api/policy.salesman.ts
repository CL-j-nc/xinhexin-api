import { Policy } from '../types/policy.types';
import { policyStore } from '../store/policyStore';

export async function createPolicy(
    data: Omit<Policy, 'policyId' | 'status'>
): Promise<Policy> {
    const policyId = `POL-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
    const policy: Policy = { ...data, policyId, status: 'SUBMITTED' };
    return policyStore.create(policy);
}

export async function getPolicy(policyId: string): Promise<Policy> {
    const policy = policyStore.get(policyId);
    if (!policy) throw new Error('Policy not found');
    return policy;
}