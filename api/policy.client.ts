import { policyStore } from '../store/policyStore';

export async function getContract(token: string) {
    const policy = policyStore.findByToken(token);
    if (!policy) throw new Error('Contract not found');

    if (policy.status === 'COMPLETED' || policy.status === 'INVALIDATED') {
        return { message: '您已完成投保' };
    }

    return {
        policy,
        payment: policy.underwritingInfo?.payment,
        status: policy.status
    };
}

export async function confirmPayment(token: string, signature: string) {
    const policy = policyStore.findByToken(token);
    if (!policy) throw new Error('Contract not found');
    if (policy.status !== 'PENDING_CLIENT_CONFIRM') {
        throw new Error('Invalid status for payment');
    }

    policy.status = 'PAID';
    return { status: 'PAID' };
}