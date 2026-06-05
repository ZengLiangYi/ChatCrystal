import { networkInterfaces } from "node:os";

function getLocalIpv4Addresses(): string[] {
	return Object.values(networkInterfaces())
		.flat()
		.filter((entry) => entry?.family === "IPv4")
		.map((entry) => entry.address);
}

function isFetchNetworkError(error: unknown): boolean {
	if (error instanceof TypeError && /fetch failed/i.test(error.message)) {
		return true;
	}
	if (error instanceof Error && error.name === "AbortError") {
		return true;
	}
	return false;
}

export function formatConnectionError(
	baseUrl: string,
	error: unknown,
	localIpv4Addresses = getLocalIpv4Addresses(),
): string {
	if (!isFetchNetworkError(error)) {
		return error instanceof Error ? error.message : String(error);
	}

	let url: URL;
	try {
		url = new URL(baseUrl);
	} catch {
		return "无法连接 ChatCrystal 核心。请检查地址格式、协议和端口。";
	}

	const origin = url.origin;
	const hostPort = `${url.hostname}${url.port ? `:${url.port}` : ""}`;
	if (url.hostname === "0.0.0.0") {
		return `无法连接 ${origin}。0.0.0.0 只能用于服务端监听，不能作为客户端连接地址；请填写云端核心所在机器的实际 IP 或域名。`;
	}

	if (localIpv4Addresses.includes(url.hostname)) {
		return `无法连接 ${origin}。${hostPort} 是本机网卡地址，但当前端口没有对该地址开放；Windows Docker Desktop 测试环境可能需要额外配置端口转发或防火墙。云端模式建议使用其他设备也能访问的实际 IP、域名，或部署到真实远程主机。`;
	}

	return `无法连接 ${origin}。请确认 ChatCrystal 云端核心正在运行，端口已对客户端开放，且地址不是 0.0.0.0。`;
}
