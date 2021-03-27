import { ApolloServer, gql } from 'apollo-server';

const typeDefs = gql`
  type Status {
    status: String!
  }

  type Query {
    status: Status
  }
`;

const resolvers = {};

const server = new ApolloServer({ typeDefs, resolvers });

server.listen().then(({ url }) => {
  console.log(`🚀  Server ready at ${url}`);
});
