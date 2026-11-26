"""Configure only the App target in the disposable CI checkout, leaving Pods automatic."""
import datetime
import hashlib
import os
import plistlib
import re
import sys
from pathlib import Path

work, project = map(Path, sys.argv[1:])
profile = plistlib.loads((work / 'profile.plist').read_bytes())
team = os.environ['APPLE_TEAM_ID']
bundle = 'cn.tboxos.ark'
entitlements = profile['Entitlements']
prefix = profile['ApplicationIdentifierPrefix'][0]
if (team not in profile['TeamIdentifier']
        or entitlements['application-identifier'] != f'{prefix}.{bundle}'
        or entitlements.get('get-task-allow') or 'ProvisionedDevices' in profile
        or profile.get('ProvisionsAllDevices')
        or profile['ExpirationDate'] <= datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)):
    sys.exit('请下载本团队 cn.tboxos.ark 的有效 App Store Connect 描述文件')

required_domains = plistlib.loads((project.parent.parent / 'App/App.entitlements').read_bytes()).get('com.apple.developer.associated-domains', [])
permitted_domains = entitlements.get('com.apple.developer.associated-domains', [])
if required_domains and '*' not in permitted_domains and any(domain not in permitted_domains for domain in required_domains):
    sys.exit('描述文件缺少 Associated Domains，请在 App ID 启用后重新生成并更新 IOS_PROFILE_BASE64')

identities = (work / 'identities').read_text()
fingerprints = [hashlib.sha1(cert).hexdigest().upper() for cert in profile['DeveloperCertificates']]
identity = next((fp for fp in fingerprints if re.search(fp + r' "Apple Distribution:', identities)), None)
if not identity:
    sys.exit('描述文件与 P12 不匹配，请导出该描述文件选中的 Apple Distribution 证书及私钥')

settings = project.read_text()
if 'CODE_SIGN_STYLE = Automatic;' not in settings:
    sys.exit('找不到 App 的自动签名配置，请检查 Xcode 工程')
settings = settings.replace('CODE_SIGN_STYLE = Automatic;', f'''CODE_SIGN_STYLE = Manual;
                DEVELOPMENT_TEAM = {team};
                CODE_SIGN_IDENTITY = "Apple Distribution";
                PROVISIONING_PROFILE_SPECIFIER = "{profile['UUID']}";''')
settings = re.sub(r'MARKETING_VERSION = [^;]+;', 'MARKETING_VERSION = ' + os.environ['IOS_MARKETING_VERSION'] + ';', settings)
project.write_text(settings)
(work / 'export.plist').write_bytes(plistlib.dumps(dict(
    method='app-store-connect', destination='export', signingStyle='manual',
    teamID=team, signingCertificate=identity, provisioningProfiles={bundle: profile['UUID']},
    manageAppVersionAndBuildNumber=False,
)))
