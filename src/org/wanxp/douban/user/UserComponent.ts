import SettingsManager from "../setting/SettingsManager";
import {App, RequestUrlParam} from "obsidian";
import {CheerioAPI, load} from "cheerio";
import {log} from "../../utils/Logutil";
import {i18nHelper} from "../../lang/helper";
import User from "./User";
import StringUtil from "../../utils/StringUtil";
import {DEFAULT_SETTINGS} from "../../constant/DefaultSettings";
import {doubanHeaders} from "../../constant/Douban";
import { request } from "https";
import HttpUtil from "../../utils/HttpUtil";
import {DEFAULT_DOUBAN_HEADERS} from "../../constant/Constsant";
import {DoubanHttpUtil} from "../../utils/DoubanHttpUtil";

/** 钥匙串存储用的 key 名前缀 */
const KC_PREFIX = 'obsidian-douban-plugin:';
const KC_COOKIE = KC_PREFIX + 'cookie';
const KC_HEADERS = KC_PREFIX + 'headers';

export default class UserComponent {
	private settingsManager: SettingsManager;
	private user: User;
	private verified: boolean = false;

	constructor(settingsManager: SettingsManager) {
		this.settingsManager = settingsManager;

	}

	getUser() {
		return this.user;
	}

	getUserId() {
		return this.user?this.user.id:null;
	}


	isLogin() {
		return this.user && this.user.login;
	}

	async logout() {
		if (this.user) {
			this.user.login = false;
		}
		this.user = null;
		this.verified = false;
		await this.settingsManager.updateSetting('loginCookiesContent', '');
		await this.settingsManager.updateSetting('loginHeadersContent', '');
		// 同时清理钥匙串
		this.clearKeychain();
	}

	/**
	 * 🗝️ 初始化时从钥匙串加载凭据（如果有），再走原有的同步检测
	 * 如果 data.json 有凭据但钥匙串没有，自动同步到钥匙串
	 */
	async initKeychain(app: App): Promise<void> {
		const ss = (app as any).secretStorage;
		if (!ss) {
			this.assumeLoggedIn();
			return;
		}
		try {
			const kcCookie = ss.getSecret(KC_COOKIE) as string | undefined;
			const kcHeaders = ss.getSecret(KC_HEADERS) as string | undefined;

			// 钥匙串有数据 → 优先用钥匙串的（覆盖 data.json）
			if (kcCookie) {
				this.settingsManager.settings.loginCookiesContent = kcCookie;
			}
			if (kcHeaders) {
				this.settingsManager.settings.loginHeadersContent = kcHeaders;
			}

			// 如果 data.json 有凭据但钥匙串没有 → 自动同步到钥匙串
			if (!kcCookie && this.settingsManager.getSetting('loginCookiesContent')) {
				this.setKeychain(KC_COOKIE, this.settingsManager.getSetting('loginCookiesContent') as string);
			}
			if (!kcHeaders && this.settingsManager.getSetting('loginHeadersContent')) {
				this.setKeychain(KC_HEADERS, this.settingsManager.getSetting('loginHeadersContent') as string);
			}
		} catch (e) {
			// 钥匙串不可用，静默降级
		}
		this.assumeLoggedIn();
	}

	assumeLoggedIn(): void {
		const headers: any = this.settingsManager.getSetting('loginHeadersContent');
		const cookies: any = this.settingsManager.getSetting('loginCookiesContent');
		if (headers || cookies) {
			this.user = new User();
			this.user.login = true;
			this.verified = false;
		}
	}

	isVerified(): boolean {
		return this.verified;
	}



	needLogin() {
		const headers:any = this.settingsManager.getSetting('loginHeadersContent') ;
		const cookies:any = this.settingsManager.getSetting('loginCookiesContent') ;

		if(!headers && !cookies) {
			return false;
		}
		return !this.isLogin();
	}


	/** 🗝️ 获取钥匙串对象 */
	private get ss(): any {
		return (this.settingsManager.app as any)?.secretStorage;
	}

	/** 保存值到钥匙串（静默降级）——用 setSecret 而非 set */
	private setKeychain(key: string, value: string): void {
		try {
			if (this.ss) this.ss.setSecret(key, value);
		} catch (e) {
			// 不支持钥匙串的版本静默忽略
		}
	}

	/** 清理钥匙串 */
	private clearKeychain(): void {
		try {
			if (this.ss) {
				this.ss.setSecret(KC_COOKIE, '');
				this.ss.setSecret(KC_HEADERS, '');
			}
		} catch (e) {
			// 静默忽略
		}
	}

	async loginHeaders(headers: object): Promise<User> {
		if(!headers) {
			return new User();
		}
		this.settingsManager.debug('配置界面:loginCookie:豆瓣headers信息正常，尝试获取用户信息,headers:' + headers);
		await this.loadUserInfoByHeaders(headers).then(user => {
			this.user = user;
			this.settingsManager.debug(`配置界面:loginCookie:豆瓣headers信息正常，${user&&user.id?'获取用户信息成功id:'+ StringUtil.confuse(user.id) + ',用户名:'+ StringUtil.confuse(user.name) :'获取用户信息失败'}`);
		});
		if(this.user) {
			this.verified = true;
			await this.settingsManager.updateSetting('loginHeadersContent', JSON.stringify(headers));
			this.setKeychain(KC_HEADERS, JSON.stringify(headers));
		}
		return this.user;
	}

	async loadUserInfoByHeaders(headers: object): Promise<User> {
		return DoubanHttpUtil.httpRequestGet('https://www.douban.com/mine/', headers, this.settingsManager)
			.then(load)
			.then(this.getUserInfo);
	}

	async loginCookie(cookie: any): Promise<User> {
		const headers: object = this.settingsManager.getHeadersByCookie(cookie);
		return this.loginHeaders(headers)
			.then(async user => {
				if(this.user) {
					await this.settingsManager.updateSetting('loginCookiesContent', cookie);
					this.setKeychain(KC_COOKIE, cookie);
				}
				return user;
			});
	}


	 async loadUserInfo(cookie: any): Promise<User> {
		 const headers1 = {
			 ...DEFAULT_DOUBAN_HEADERS,
			 Cookie: cookie
		 }
		return DoubanHttpUtil.httpRequestGet('https://www.douban.com/mine/', headers1, this.settingsManager)
			.then(load)
			.then(this.getUserInfo);
	};


	private getUserInfo(dataHtml: CheerioAPI): User {
		let elements = dataHtml("#db-usr-profile > div.pic > a");
		if (!elements) {
			return new User();
		}
		let name = dataHtml(dataHtml("head > title").get(0)).text().trim();
		let userUrl = dataHtml(elements.get(0)).attr("href");
		if (!name && !userUrl) {
			return new User();
		}
		let id = '';
		if (userUrl && userUrl.indexOf('people/') > 0) {
			id = userUrl.substring(userUrl.lastIndexOf('people/') + 7, userUrl.lastIndexOf('/'));
		}
		if (!id) {
			return new User();
		}
		return {
			id: id,
			name: name,
			url: userUrl,
			login: true
		};
	};


	async login() {
		let headers:object = this.settingsManager.getHeaders();
		if(!headers) {
			this.settingsManager.debug('主界面:login:无豆瓣信息，获取用户信息失败');
			return new User();
		}
		this.settingsManager.debug('主界面:login:豆瓣headers信息正常，尝试获取用户信息');
		await this.loadUserInfoByHeaders(headers).then(user => {
			this.user = user;
			this.settingsManager.debug(`主界面:loginByCookie:豆瓣cookies信息正常，${user&&user.id?'获取用户信息成功id:'+ StringUtil.confuse(user.id) + ',用户名:'+ StringUtil.confuse(user.name) :'获取用户信息失败'}`);
		});
		if (this.user && this.user.id) {
			this.verified = true;
		}
		return this.user;
	}
}
