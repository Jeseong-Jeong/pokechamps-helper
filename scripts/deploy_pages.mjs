// GitHub Pages 배포: npm run deploy
// 커밋된 site/ 폴더만 떼어서 gh-pages 브랜치로 올립니다 (Pages 소스 = gh-pages 브랜치 루트).
// 먼저 빌드하고 커밋까지 한 뒤 실행하세요.
import {execSync} from 'node:child_process';

const sh = cmd => execSync(cmd, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit']}).trim();

if (sh('git status --porcelain -- site')) {
  console.error('site/ 에 커밋하지 않은 변경이 있습니다. 먼저 커밋하세요.');
  process.exit(1);
}
const sha = sh('git subtree split --prefix site HEAD');
sh(`git push origin ${sha}:refs/heads/gh-pages --force`);
console.log(`배포함: gh-pages ← ${sha.slice(0, 7)}`);
console.log('https://jeseong-jeong.github.io/pokechamps-helper/ (반영까지 1~2분)');
