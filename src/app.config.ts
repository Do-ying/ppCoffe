export default defineAppConfig({
  pages: [
    'pages/home/index',
    'pages/brew/list/index',
    'pages/bean/list/index',
    'pages/brew/method/index',
    'pages/brew/params/index',
    'pages/brew/flavor/index',
    'pages/brew/detail/index',
    'pages/bean/detail/index',
    'pages/bean/edit/index',
    'pages/roast/edit/index',
    'pages/equipment/list/index',
    'pages/equipment/edit/index',
    'pages/curve/index/index',
    'pages/settings/index'
  ],
  window: {
    backgroundTextStyle: 'dark',
    navigationBarBackgroundColor: '#0D0F0E',
    navigationBarTitleText: 'ppCoffe',
    navigationBarTextStyle: 'white',
    backgroundColor: '#0D0F0E'
  },
  tabBar: {
    color: '#69726C',
    selectedColor: '#7FD1C1',
    backgroundColor: '#151817',
    borderStyle: 'black',
    list: [
      {
        pagePath: 'pages/home/index',
        text: '首页',
        iconPath: 'assets/tabbar/home-normal.png',
        selectedIconPath: 'assets/tabbar/home-active.png'
      },
      {
        pagePath: 'pages/brew/list/index',
        text: '记录',
        iconPath: 'assets/tabbar/log-normal.png',
        selectedIconPath: 'assets/tabbar/log-active.png'
      },
      {
        pagePath: 'pages/bean/list/index',
        text: '豆仓',
        iconPath: 'assets/tabbar/bean-normal.png',
        selectedIconPath: 'assets/tabbar/bean-active.png'
      }
    ]
  }
})
