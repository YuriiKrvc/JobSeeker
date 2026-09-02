import { DatabaseOutlined, ProfileOutlined } from '@ant-design/icons'
import { Layout, Menu, theme } from 'antd'
import { NavLink, Outlet, useLocation } from 'react-router'

const { Header, Sider, Content } = Layout

const navItems = [
  {
    key: '/postings',
    icon: <ProfileOutlined />,
    label: <NavLink to="/postings">Postings</NavLink>,
  },
  {
    key: '/sources',
    icon: <DatabaseOutlined />,
    label: <NavLink to="/sources">Sources</NavLink>,
  },
]

const AppLayout = () => {
  const { pathname } = useLocation()
  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken()

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider collapsible>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[pathname]}
          items={navItems}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            paddingInline: 24,
            background: colorBgContainer,
            fontSize: 18,
            fontWeight: 600,
          }}
        >
          JobSeeker
        </Header>
        <Content
          style={{
            margin: 24,
            padding: 24,
            background: colorBgContainer,
            borderRadius: borderRadiusLG,
          }}
        >
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}

export default AppLayout
