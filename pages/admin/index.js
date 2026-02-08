// pages/admin/index.js
export async function getServerSideProps() {
  return {
    redirect: {
      destination: "/admin/suppliers",
      permanent: false,
    },
  };
}

export default function AdminIndex() {
  return null;
}
