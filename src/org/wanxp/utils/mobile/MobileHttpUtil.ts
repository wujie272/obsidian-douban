import SettingsManager from "../../douban/setting/SettingsManager";
import {requestUrl, RequestUrlParam, RequestUrlResponse} from "obsidian";
import {log} from "../Logutil";
import {i18nHelper} from "../../lang/helper";
import {DoubanHttpUtil} from "../DoubanHttpUtil";
import {request} from "https";

export default class MobileHttpUtil {
	/**
	 * 清理有冲突的请求头（Host, Connection等），换上真正的手机UA
	 */
	private static cleanHeaders(raw: any, url: string): Record<string, string> {
		const HEADERS_TO_DROP = new Set([
			'host', 'connection', 'content-length',
			'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site', 'sec-fetch-user',
			'upgrade-insecure-requests',
		]);
		const clean: Record<string, string> = {};
		if (raw) {
			for (const [k, v] of Object.entries(raw)) {
				if (v == null || v === '') continue;
				if (HEADERS_TO_DROP.has(k.toLowerCase())) continue;
				clean[k] = String(v);
			}
		}
		// 保证必须的头
		if (!clean['User-Agent']) {
			clean['User-Agent'] = 'Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
		}
		// 带上Cookie（从原始头提取）
		if (raw && raw['Cookie']) {
			clean['Cookie'] = String(raw['Cookie']);
		}
		return clean;
	}

	/**
	 * get请求
	 * @param url 请求地址
	 * @param headers 请求参数
	 * @param settingsManager 设置管理器
	 */
	public static httpRequestGet(url: string, headers: any, settingsManager?: SettingsManager): Promise<RequestUrlResponse> {
		return this.httpRequestGetInner(url, headers, 0, settingsManager);
	}
	private static async httpRequestGetInner(url: string, headers: any, times:number, settingsManager?: SettingsManager): Promise<RequestUrlResponse> {

		const cleanHeaders = this.cleanHeaders(headers, url);

		let requestUrlParam: RequestUrlParam = {
			url: url,
			method: "GET",
			headers: cleanHeaders,
			throw: true,
		};
		return await requestUrl(requestUrlParam)
			// .then(res => res.text)
			.then(response => {
				if (response && response.text.indexOf('https://sec.douban.com/a') > 0) {
					log.notice(i18nHelper.getMessage('130105'))
					if (settingsManager) {
						settingsManager.debug(`Obsidian-Douban:获取异常网页如下:\n${response}`);
					}
				}
				if (response.status == 301 || response.status == 302 || response.status == 303 || response.status == 307) {
					if (times > 2) {
						throw new Error('重定向次数过多');
					}
					let location = response.headers['location'];
					settingsManager.debug(`Obsidian-Douban:获取重定向地址如下:\n${location}`);
					if (location.indexOf('http') != 0) {
						return this.httpRequestGetInner(location, headers, times + 1, settingsManager);
					} else {
						throw new Error('重定地址错误');
					}
				}
				settingsManager.debug(`Obsidian-Douban:获取网页如下:\n${response}`);
				return response;
			})
			.then(s => DoubanHttpUtil.humanCheck(s, url, settingsManager))
			.catch(e => {
				if (e.toString().indexOf('403') > 0) {
					throw log.error(i18nHelper.getMessage('130105'), e)
				} else {
					throw log.error(i18nHelper.getMessage('130101').replace('{0}', e.toString()), e)
				}
			});
	}




}
