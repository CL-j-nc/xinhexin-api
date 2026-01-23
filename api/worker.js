// xinhexin-p-hebao/pages/Underwriting.tsx

import React, { useState, useEffect } from "react";

function Underwriting({ policy }) {
    const [someState, setSomeState] = useState(null);
    const [verifyCode, setVerifyCode] = useState < string | null > (null);

    const handleApprove = async () => {
        // existing approval logic here

        await fetch("https://xinhexin-api.chinalife-shiexinhexin.workers.dev/policy/approve", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                policyId: policy.policyId
            })
        })
            .then(res => res.json())
            .then(data => {
                setVerifyCode(data.verifyCode);
            });
    };

    return (
        <div>
            {/* existing JSX */}
            <button onClick={handleApprove}>核保通过 / 出单</button>

            {verifyCode && (
                <div className="mt-4 p-3 rounded-lg bg-emerald-50 text-emerald-700 font-mono text-lg">
                    客户验证码：{verifyCode}
                </div>
            )}
        </div>
    );
}

export default Underwriting;


// xinhexin-client/pages/Client.tsx

import React, { useState, useEffect } from "react";

function Client({ policyId }) {
    const [code, setCode] = useState("");
    const [verified, setVerified] = useState(false);
    const [error, setError] = useState("");

    const verifyCode = async () => {
        const res = await fetch(
            "https://xinhexin-api.chinalife-shiexinhexin.workers.dev/policy/verify-code",
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    policyId,
                    code
                })
            }
        );

        const data = await res.json();

        if (data.pass) {
            setVerified(true);
            setError("");
        } else {
            setError("验证码错误，请重新输入");
        }
    };

    return (
        <div>
            {!verified && (
                <div className="p-4 rounded-xl bg-white shadow">
                    <div className="mb-2 text-sm text-slate-600">请输入核保提供的验证码</div>
                    <input
                        className="input-base mb-2"
                        value={code}
                        onChange={e => setCode(e.target.value)}
                        placeholder="6 位验证码"
                    />
                    {error && <div className="text-red-500 text-sm mb-2">{error}</div>}
                    <button className="btn-primary w-full" onClick={verifyCode}>
                        验证并继续
                    </button>
                </div>
            )}

            {verified && (
                <>
                    {/* ...原有页面内容... */}
                </>
            )}
        </div>
    );
}

export default Client;