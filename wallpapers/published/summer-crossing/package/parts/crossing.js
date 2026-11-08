'use strict';
// The crossing: the painted gate arm on the box, and the painted lit lenses with a small glow. Sprites: make_crossing.py.
(() => {
// a straight painted sprite, turned rigidly about its pivot. The texture is premultiplied.
const FS_ARM = `
in vec2 vA; out vec4 frag;
uniform vec2 uPivot,uDirA; uniform vec4 uRect; uniform sampler2D uTex;
void main(){
  vec2 d=vA-uPivot; vec2 uv=(vec2(dot(d,uDirA),dot(d,vec2(-uDirA.y,uDirA.x)))-uRect.xy)/uRect.zw;
  if(uv.x<0.||uv.y<0.||uv.x>1.||uv.y>1.) discard;
  vec4 s=texture(uTex,uv,-.5);
  if(s.a<.003) discard;
  frag=vec4(s.rgb*cloudShadow(vA,0.),s.a);
}`;
// the painted lit lens over the painted one, and a small soft glow around it
const FS_LAMP = `
in vec2 vA; out vec4 frag; uniform vec2 uLamps; uniform sampler2D uLit;
const vec2 L1=vec2(497.3,391.2),L2=vec2(585.6,391.5); const float R=23.;
void main(){
  bool left=vA.x<541.75; float on=left?uLamps.x:uLamps.y; vec2 d=vA-(left?L1:L2);
  vec4 s=vec4(0.);
  if(abs(d.x)<R&&abs(d.y)<R){ vec2 uv=d/(2.*R)+.5; s=texture(uLit,vec2((uv.x+(left?0.:1.))*.5,uv.y)); }
  float g=exp(-pow(max(length(d)-12.,0.)/10.,2.));
  frag=vec4(s.rgb*on+g*on*.05*vec3(1.,.16,.06)*(1.-s.a),s.a*on);
}`;
const PIVOT = [602.07, 553.05], ARM = { s0: -10.49, t0: -8.33, w: 382.22, h: 16.67 }, HUB = [584, 538, 32, 30];
let pArm, pLamp, lit = [0, 0], litT = -1, settle = 0, armT = -1;
SC.part({
  title: 'Crossing',
  files: { crossingArm: 'assets/crossing-arm.png', crossingHub: 'assets/crossing-hub.png', crossingLit: 'assets/crossing-lamps.png' },
  setup(ctx) {
    const { gl } = ctx;
    pArm = ctx.program(ctx.VS_QUAD, ctx.COMMON + FS_ARM, ['uPivot', 'uDirA', 'uRect', 'uTex']);
    pLamp = ctx.program(ctx.VS_QUAD, ctx.COMMON + FS_LAMP, ['uLamps', 'uLit']);
    // the arm turns and shrinks with the screen: mips keep its thin edges from crawling
    ctx.use(pArm); ctx.bindTex(pArm, 'uTex', 'crossingArm'); gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  },
  draw: {
    gate(ctx) {
      const { gl, ev, time } = ctx;
      if (!ctx.settings.gate) return;     // a wallpaper checkbox, on by default
      // the settle at the bottom, softened: heavy arm, no kick the moment it lands. A jump in time (seeking) just snaps.
      const dt = time - armT, to = ev.gateBounce || 0; armT = time;
      settle = dt < 0 || dt > .4 ? to : to + (settle - to) * Math.exp(-dt / .14);
      const REST = 80 * Math.PI / 180, ang = REST * (1 - ev.gate) + settle;
      const [px, py] = PIVOT, dx = Math.cos(ang), dy = -Math.sin(ang), A = ARM;
      // the mount on the box stays put, the arm turns on it
      ctx.use(pArm); ctx.bindTex(pArm, 'uTex', 'crossingHub');
      gl.uniform2f(pArm.u.uPivot, HUB[0], HUB[1]); gl.uniform2f(pArm.u.uDirA, 1, 0); gl.uniform4f(pArm.u.uRect, 0, 0, HUB[2], HUB[3]);
      ctx.quad(pArm, HUB[0], HUB[1], HUB[0] + HUB[2], HUB[1] + HUB[3]);
      ctx.use(pArm); ctx.bindTex(pArm, 'uTex', 'crossingArm');
      gl.uniform2f(pArm.u.uPivot, px, py); gl.uniform2f(pArm.u.uDirA, dx, dy); gl.uniform4f(pArm.u.uRect, A.s0, A.t0, A.w, A.h);
      const xs = [], ys = [];
      for (const s of [A.s0, A.s0 + A.w]) for (const t of [A.t0, A.t0 + A.h]) { xs.push(px + s * dx - t * dy); ys.push(py + s * dy + t * dx); }
      ctx.quad(pArm, Math.min(...xs) - 1, Math.min(...ys) - 1, Math.max(...xs) + 1, Math.max(...ys) + 1);
    },
    top(ctx) {
      const { gl, ev, time } = ctx;
      // a quick soft fade: the timing is ev.lamps, the filament follows it. A jump in time (seeking) just snaps.
      const dt = time - litT; litT = time;
      for (const i of [0, 1]) {
        const to = ev.lamps[i], tau = to > lit[i] ? .05 : .09;
        lit[i] = dt < 0 || dt > .4 ? to : to + (lit[i] - to) * Math.exp(-dt / tau);
        if (lit[i] < .004) lit[i] = 0;
      }
      if (lit[0] + lit[1] <= 0) return;
      ctx.use(pLamp); ctx.bindTex(pLamp, 'uLit', 'crossingLit');
      gl.uniform2f(pLamp.u.uLamps, lit[0], lit[1]);
      ctx.quad(pLamp, 450, 345, 634, 438);
    },
  },
});
})();
