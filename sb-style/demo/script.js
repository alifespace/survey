const root=document.documentElement;
const themeButton=document.querySelector('.theme-toggle');
const savedTheme=localStorage.getItem('orbit-theme');
if(savedTheme) root.dataset.theme=savedTheme;
themeButton.addEventListener('click',()=>{const light=root.dataset.theme==='light';root.dataset.theme=light?'dark':'light';localStorage.setItem('orbit-theme',root.dataset.theme);themeButton.setAttribute('aria-label',`切换到${light?'浅色':'深色'}主题`)});

const header=document.querySelector('.site-header');
addEventListener('scroll',()=>header.classList.toggle('scrolled',scrollY>12),{passive:true});
const menuButton=document.querySelector('.menu-toggle');
const mobileMenu=document.querySelector('.mobile-menu');
menuButton.addEventListener('click',()=>{const open=menuButton.getAttribute('aria-expanded')==='true';menuButton.setAttribute('aria-expanded',String(!open));menuButton.setAttribute('aria-label',open?'打开菜单':'关闭菜单');mobileMenu.hidden=open});
mobileMenu.addEventListener('click',e=>{if(e.target.matches('a')){mobileMenu.hidden=true;menuButton.setAttribute('aria-expanded','false')}});

const panelContent={
 database:{title:'SQL editor',time:'Query completed in 18ms',code:`<span class="code-muted">-- 查看近 30 天增长最快的账户</span>\n<span class="code-blue">select</span> company, plan,\n  <span class="code-blue">sum</span>(events) <span class="code-blue">as</span> usage\n<span class="code-blue">from</span> customer_activity\n<span class="code-blue">where</span> created_at &gt; now() - <span class="code-green">'30 days'</span>\n<span class="code-blue">group by</span> company, plan\n<span class="code-blue">order by</span> usage <span class="code-blue">desc</span>;`},
 auth:{title:'Policy editor',time:'Policy passed',code:`<span class="code-muted">-- 成员只能访问自己的工作空间</span>\n<span class="code-blue">create policy</span> <span class="code-green">"workspace access"</span>\n<span class="code-blue">on</span> spaces <span class="code-blue">for all</span>\n<span class="code-blue">using</span> (\n  auth.user_id() <span class="code-blue">in</span> (\n    <span class="code-blue">select</span> user_id <span class="code-blue">from</span> members\n  )\n);`},
 realtime:{title:'Event inspector',time:'5 subscribers online',code:`<span class="code-muted">// 订阅指定工作空间的变化</span>\norbit.channel(<span class="code-green">'space:alpha'</span>)\n  .on(<span class="code-green">'row.updated'</span>, event =&gt; {\n    render(event.record)\n  })\n  .subscribe()`},
 functions:{title:'Edge function',time:'Deployed to 14 regions',code:`<span class="code-blue">export default</span> <span class="code-blue">async</span> (request) =&gt; {\n  <span class="code-blue">const</span> event = <span class="code-blue">await</span> request.json()\n  <span class="code-blue">await</span> orbit.events.insert(event)\n\n  <span class="code-blue">return new</span> Response(<span class="code-green">'accepted'</span>, {\n    status: <span class="code-green">201</span>\n  })\n}`}
};
document.querySelectorAll('.capability-tabs button').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('.capability-tabs button').forEach(b=>b.setAttribute('aria-selected','false'));button.setAttribute('aria-selected','true');const data=panelContent[button.dataset.panel];const panel=document.querySelector('#capability-panel');panel.querySelector('.demo-top span:first-child').textContent=data.title;panel.querySelector('.query-time').textContent=data.time;panel.querySelector('code').innerHTML=data.code}));

const copyButton=document.querySelector('.copy-code');
copyButton.addEventListener('click',async()=>{const text=document.querySelector('#code-sample').innerText;try{await navigator.clipboard.writeText(text);copyButton.textContent='已复制';document.querySelector('.toast').classList.add('show');setTimeout(()=>{copyButton.textContent='复制';document.querySelector('.toast').classList.remove('show')},1600)}catch{copyButton.textContent='复制失败'}});

const observer=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('visible');observer.unobserve(e.target)}}),{threshold:.1});
document.querySelectorAll('.reveal').forEach(el=>observer.observe(el));
