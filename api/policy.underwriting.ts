import { CoverageLevel } from '../types/policy.types';
import { policyStore } from '../store/policyStore';

export async function rejectPolicy(policyId: string, reason: string) {
    return policyStore.update(policyId, p => {
        p.status = 'UNDERWRITING_REJECTED';
        p.underwritingInfo = {
            ...p.underwritingInfo,
            rejectReason: reason
        };
    });
}

export async function approvePolicy(
    policyId: string,
    finalCoverages: CoverageLevel[],
    payment: { alipayQr: string }
) {
    const contractToken = `TOKEN-${Math.random().toString(36).substr(2, 12)}`;
    return policyStore.update(policyId, p => {
        p.status = 'PENDING_CLIENT_CONFIRM';
        p.coverages = finalCoverages;
        p.underwritingInfo = {
            ...p.underwritingInfo,
            payment,
            contractToken
        };
    });
}

export async function completePolicy(policyId: string) {
    return policyStore.update(policyId, p => {
        p.status = 'COMPLETED';
    });
}