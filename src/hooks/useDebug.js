import { useState, useEffect } from "react";
import { requestsApi } from "../lib/api.js";

export function useDebug(requestId) {
	const [data, setData] = useState(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(null);

	useEffect(() => {
		let cancelled = false;
		// Clear stale payload so switching rows never briefly shows the previous
		// request's raw data.
		setData(null);
		setError(null);
		setLoading(true);
		requestsApi
			.debug(requestId)
			.then((res) => {
				if (!cancelled) setData(res);
			})
			.catch((err) => {
				if (!cancelled) setError(err.message);
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [requestId]);

	return { data, loading, error };
}
