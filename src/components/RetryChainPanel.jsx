export default function RetryChain({
	retryHistory,
	attemptCount,
	finalProvider,
	finalModel,
	allProviders,
}) {
	if (!retryHistory) {
		return <p className="text-slate-500">No retry data recorded.</p>;
	}

	let attempts = [];
	try {
		attempts =
			typeof retryHistory === "string"
				? JSON.parse(retryHistory)
				: retryHistory;
	} catch {
		return <p className="text-red-600">Could not parse retry history.</p>;
	}

	if (!Array.isArray(attempts) || attempts.length === 0) {
		return <p className="text-slate-500">No retry data recorded.</p>;
	}

	return (
		<div className="space-y-3">
			<div className="flex gap-4 text-sm mb-3">
				<span>
					<strong>Total attempts:</strong> {attemptCount}
				</span>
				<span>
					<strong>Final provider:</strong> {finalProvider || "-"}
				</span>
				<span>
					<strong>Final model:</strong> {finalModel || "-"}
				</span>
			</div>
			{allProviders && (
				<p className="text-xs text-slate-500">
					<strong>All attempted:</strong> {allProviders}
				</p>
			)}
			<div className="space-y-2">
				{attempts.map((a, i) => (
					<div
						key={i}
						className={`border rounded p-3 text-sm ${a.status === "success" ? "border-green-300 bg-green-50" : "border-red-300 bg-red-50"}`}
					>
						<div className="flex justify-between items-center mb-1">
							<span className="font-semibold">Attempt {a.index || i + 1}</span>
							<div className="flex gap-2">
								<span
									className={`px-2 py-0.5 rounded text-xs ${a.status === "success" ? "bg-green-200 text-green-800" : "bg-red-200 text-red-800"}`}
								>
									{a.status}
								</span>
								{a.retryable && (
									<span className="px-2 py-0.5 rounded text-xs bg-amber-200 text-amber-800">
										retryable
									</span>
								)}
							</div>
						</div>
						<p>
							<strong>Provider:</strong> {a.provider} &nbsp;{" "}
							<strong>Model:</strong> {a.model}
						</p>
						<p>
							<strong>API type:</strong> {a.apiType || "-"}
						</p>
						<p>
							<strong>Reason:</strong> {a.reason || "-"}
						</p>
						{a.statusCode && (
							<p>
								<strong>Status code:</strong> {a.statusCode}
							</p>
						)}
					</div>
				))}
			</div>
		</div>
	);
}
